import { Router, Request, Response } from 'express';
import { z } from 'zod';
import dataFetcherManager from '../services/dataFetcherManager';
import { getSchedulerStatus } from '../services/scheduler';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import OHLCVRepository from '../models/OHLCVRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import UnifiedAssetRepository from '../models/UnifiedAssetRepository';
import assetMappingService from '../services/assetMappingService';
import { logger } from '../utils/logger';
import createProgressStream from './createProgressStream';
import type { OHLCVDataWithAsset } from '../models/types';

const router = Router();

const parseDecimal = (value: string | null) => (value === null ? null : Number(value));

const serializeOHLCVRecord = (record: OHLCVDataWithAsset) => ({
  ...record,
  open: Number(record.open),
  high: Number(record.high),
  low: Number(record.low),
  close: Number(record.close),
  volume: parseDecimal(record.volume),
  quote_volume: parseDecimal(record.quote_volume),
});

/**
 * GET /api/fetch/stream
 * Server-Sent Events endpoint for initial data fetch with real-time progress
 */
router.get(
  '/fetch/stream',
  createProgressStream('fetch/stream', async (fetcher) => fetcher.fetchInitialData())
);

/**
 * GET /api/fetch/incremental/stream
 * Server-Sent Events endpoint for incremental fetch with real-time progress
 */
router.get(
  '/fetch/incremental/stream',
  createProgressStream('fetch/incremental/stream', async (fetcher) => fetcher.fetchIncrementalData())
);

/**
 * POST /api/fetch
 * Manually trigger initial data fetch (without streaming)
 */
router.post('/fetch', async (req: Request, res: Response) => {
  try {
    const platform = (req.query.platform as string) || (req.body.platform as string) || 'hyperliquid';
    logger.info(`Manual fetch triggered for platform: ${platform}`);

    const fetcher = dataFetcherManager.getFetcher(platform);
    const result = await fetcher.fetchInitialData();

    res.json({
      success: true,
      message: 'Data fetch completed',
      data: result,
    });
  } catch (error) {
    logger.error('Fetch endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch data',
      error: `${error}`,
    });
  }
});

/**
 * POST /api/fetch/incremental
 * Manually trigger incremental data fetch (without streaming)
 */
router.post('/fetch/incremental', async (req: Request, res: Response) => {
  try {
    const platform = (req.query.platform as string) || (req.body.platform as string) || 'hyperliquid';
    logger.info(`Manual incremental fetch triggered for platform: ${platform}`);

    const fetcher = dataFetcherManager.getFetcher(platform);
    const result = await fetcher.fetchIncrementalData();

    res.json({
      success: true,
      message: 'Incremental fetch completed',
      data: result,
    });
  } catch (error) {
    logger.error('Incremental fetch endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incremental data',
      error: `${error}`,
    });
  }
});

/**
 * POST /api/resample/hyperliquid-8h
 * Resample Hyperliquid 1-hour data to 8-hour intervals for comparison with Binance
 */
router.post('/resample/hyperliquid-8h', async (_req: Request, res: Response) => {
  try {
    logger.info('Resampling Hyperliquid data to 8-hour intervals');

    const fetcher = dataFetcherManager.getFetcher('hyperliquid');
    const result = await fetcher.resampleHyperliquidTo8h();

    res.json({
      success: true,
      message: '8-hour resampling completed',
      data: result,
    });
  } catch (error) {
    logger.error('Resampling endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resample data',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/status
 * Get system status and last fetch information
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const platform = (req.query.platform as string) || 'hyperliquid';
    const fetcher = dataFetcherManager.getFetcher(platform);
    const [status, schedulerStatus, recentErrors] = await Promise.all([
      fetcher.getStatus(),
      Promise.resolve(getSchedulerStatus()),
      FetchLogRepository.getRecentErrors(platform, 5),
    ]);

    res.json({
      success: true,
      data: {
        ...status,
        scheduler: schedulerStatus,
        recentErrors,
      },
    });
  } catch (error) {
    logger.error('Status endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get status',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/assets
 * List all available assets
 */
router.get('/assets', async (req: Request, res: Response) => {
  try {
    const { platform } = req.query;

    const assets = platform
      ? await AssetRepository.findByPlatform(platform as string)
      : await AssetRepository.findAllActive();

    // Get staleness info for assets (only if platform is specified)
    let stalenessMap: Map<number, number> | null = null;
    if (platform) {
      stalenessMap = await FundingRateRepository.getAssetStaleness(platform as string);
    }

    // Add staleness info to each asset
    const assetsWithStaleness = assets.map(asset => ({
      ...asset,
      daysStale: stalenessMap ? (stalenessMap.get(asset.id) || 999) : undefined,
    }));

    res.json({
      success: true,
      data: assetsWithStaleness,
      count: assets.length,
    });
  } catch (error) {
    logger.error('Assets endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assets',
      error: `${error}`,
    });
  }
});

const MAX_FUNDING_RATE_LIMIT = 10000;

const dateStringSchema = z
  .string()
  .trim()
  .min(1, { message: 'Date cannot be empty' })
  .refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date format',
  })
  .transform(value => new Date(value));

const fundingRatesQuerySchema = z
  .object({
    asset: z.string().trim().min(1, { message: 'asset cannot be empty' }).optional(),
    platform: z.string().trim().min(1, { message: 'platform cannot be empty' }).optional(),
    sampling_interval: z
      .string()
      .trim()
      .min(1, { message: 'sampling_interval cannot be empty' })
      .optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    limit: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(1).max(MAX_FUNDING_RATE_LIMIT))
      .optional()
      .default(1000),
    offset: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(0))
      .optional()
      .default(0),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startDate must be before or equal to endDate',
        path: ['startDate'],
      });
    }
  });

/**
 * GET /api/funding-rates
 * Get funding rates with filters
 * Query params: asset, startDate, endDate, platform, sampling_interval, limit, offset
 */
router.get('/funding-rates', async (req: Request, res: Response) => {
  try {
    const parseResult = fundingRatesQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      const { fieldErrors, formErrors } = parseResult.error.flatten();
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters for funding rates',
        errors: {
          ...fieldErrors,
          ...(formErrors.length ? { _errors: formErrors } : {}),
        },
      });
    }

    const { asset, startDate, endDate, platform, sampling_interval, limit, offset } = parseResult.data;

    logger.info('[API] Funding rates request', {
      asset,
      startDate,
      endDate,
      platform,
      sampling_interval,
      limit,
      offset,
    });

    const query: any = {
      limit,
      offset,
    };

    if (asset) query.asset = asset;
    if (platform) query.platform = platform;
    if (sampling_interval) query.sampling_interval = sampling_interval;
    if (startDate) query.startDate = startDate;
    if (endDate) query.endDate = endDate;

    logger.debug('[API] Querying funding rates with', query);
    const fundingRates = await FundingRateRepository.find(query);
    logger.info('[API] Funding rates query completed', {
      asset,
      platform: query.platform || 'all',
      sampling_interval: query.sampling_interval || 'all',
      results: fundingRates.length,
    });

    res.json({
      success: true,
      data: fundingRates,
      count: fundingRates.length,
      query: {
        asset: query.asset || 'all',
        platform: query.platform || 'all',
        sampling_interval: query.sampling_interval || 'all',
        startDate: query.startDate,
        endDate: query.endDate,
        limit: query.limit,
        offset: query.offset,
      },
    });
  } catch (error) {
    logger.error('Funding rates endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch funding rates',
      error: `${error}`,
    });
  }
});

const MAX_OHLCV_LIMIT = 10000;

const ohlcvQuerySchema = z
  .object({
    asset: z.string().trim().min(1, { message: 'asset cannot be empty' }).optional(),
    platform: z.string().trim().min(1, { message: 'platform cannot be empty' }).optional(),
    timeframe: z
      .string()
      .trim()
      .min(1, { message: 'timeframe cannot be empty' })
      .optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    limit: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(1).max(MAX_OHLCV_LIMIT))
      .optional()
      .default(1000),
    offset: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(0))
      .optional()
      .default(0),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startDate must be before or equal to endDate',
        path: ['startDate'],
      });
    }
  });

/**
 * GET /api/ohlcv
 * Get OHLCV data with filters
 * Query params: asset, startDate, endDate, platform, timeframe, limit, offset
 */
router.get('/ohlcv', async (req: Request, res: Response) => {
  try {
    const parseResult = ohlcvQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      const { fieldErrors, formErrors } = parseResult.error.flatten();
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters for OHLCV data',
        errors: {
          ...fieldErrors,
          ...(formErrors.length ? { _errors: formErrors } : {}),
        },
      });
    }

    const { asset, startDate, endDate, platform, timeframe, limit, offset } = parseResult.data;

    logger.info('[API] OHLCV request', {
      asset,
      startDate,
      endDate,
      platform,
      timeframe,
      limit,
      offset,
    });

    const query: any = {
      limit,
      offset,
    };

    if (asset) query.asset = asset;
    if (platform) query.platform = platform;
    if (timeframe) query.timeframe = timeframe;
    if (startDate) query.startDate = startDate;
    if (endDate) query.endDate = endDate;

    logger.debug('[API] Querying OHLCV with', query);
    const ohlcvData = await OHLCVRepository.find(query);
    logger.info(`[API] Found ${ohlcvData.length} OHLCV records for query:`, query);
    const serializedData = ohlcvData.map(serializeOHLCVRecord);
    logger.info('[API] OHLCV query completed', {
      asset,
      platform: query.platform || 'all',
      timeframe: query.timeframe || 'all',
      results: serializedData.length,
    });

    res.json({
      success: true,
      data: serializedData,
      count: serializedData.length,
      query: {
        asset: query.asset || 'all',
        platform: query.platform || 'all',
        timeframe: query.timeframe || 'all',
        startDate: query.startDate,
        endDate: query.endDate,
        limit: query.limit,
        offset: query.offset,
      },
    });
  } catch (error) {
    logger.error('OHLCV endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch OHLCV data',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/analytics/:asset
 * Get analytics for specific asset
 */
router.get('/analytics/:asset', async (req: Request, res: Response) => {
  try {
    const { asset } = req.params;
    const { platform = 'hyperliquid' } = req.query;

    const analytics = await FundingRateRepository.getAssetAnalytics(
      asset,
      platform as string
    );

    if (!analytics) {
      return res.status(404).json({
        success: false,
        message: `Asset ${asset} not found`,
      });
    }

    return res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error('Analytics endpoint error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/logs
 * Get recent fetch logs
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { limit = '10' } = req.query;

    const logs = await FetchLogRepository.getRecent(parseInt(limit as string));

    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    logger.error('Logs endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  const schedulerStatus = getSchedulerStatus();
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    scheduler: schedulerStatus,
  });
});

/**
 * GET /api/unified-assets
 * Get all unified assets with their platform mappings
 */
router.get('/unified-assets', async (_req: Request, res: Response) => {
  try {
    const unifiedAssets = await UnifiedAssetRepository.findAllWithMappings();

    return res.json({
      success: true,
      data: unifiedAssets,
      count: unifiedAssets.length,
    });
  } catch (error) {
    logger.error('Unified assets endpoint error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unified assets',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/unified-assets/multi-platform?minPlatforms=3
 * Get unified assets available on at least N platforms
 */
router.get('/unified-assets/multi-platform', async (req: Request, res: Response) => {
  try {
    const minPlatforms = parseInt(req.query.minPlatforms as string) || 3;

    if (minPlatforms < 1 || minPlatforms > 10) {
      return res.status(400).json({
        success: false,
        message: 'minPlatforms must be between 1 and 10',
      });
    }

    const multiPlatformAssets = await UnifiedAssetRepository.findMultiPlatformAssets(
      minPlatforms
    );

    return res.json({
      success: true,
      data: multiPlatformAssets,
      count: multiPlatformAssets.length,
      minPlatforms,
    });
  } catch (error) {
    logger.error('Multi-platform assets endpoint error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch multi-platform assets',
      error: `${error}`,
    });
  }
});

/**
 * GET /api/unified-assets/:id
 * Get a specific unified asset with its mappings
 */
router.get('/unified-assets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const unifiedAsset = await UnifiedAssetRepository.findWithMappings(parseInt(id));

    if (!unifiedAsset) {
      return res.status(404).json({
        success: false,
        message: `Unified asset ${id} not found`,
      });
    }

    return res.json({
      success: true,
      data: unifiedAsset,
    });
  } catch (error) {
    logger.error('Unified asset endpoint error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unified asset',
      error: `${error}`,
    });
  }
});

/**
 * POST /api/unified-assets/generate-mappings
 * Generate asset mappings across all platforms
 */
router.post('/unified-assets/generate-mappings', async (_req: Request, res: Response) => {
  try {
    logger.info('Generating asset mappings');

    const result = await assetMappingService.generateMappings();

    return res.json({
      success: true,
      message: 'Asset mappings generated',
      data: result,
    });
  } catch (error) {
    logger.error('Generate mappings endpoint error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate mappings',
      error: `${error}`,
    });
  }
});

/**
 * POST /api/unified-assets/manual-mapping
 * Manually create a mapping between an asset and a unified asset
 */
router.post('/unified-assets/manual-mapping', async (req: Request, res: Response) => {
  try {
    const { assetId, normalizedSymbol } = req.body;

    if (!assetId || !normalizedSymbol) {
      return res.status(400).json({
        success: false,
        message: 'assetId and normalizedSymbol are required',
      });
    }

    const result = await assetMappingService.createManualMapping(assetId, normalizedSymbol);

    return res.json({
      success: result,
      message: result ? 'Manual mapping created' : 'Failed to create manual mapping',
    });
  } catch (error) {
    logger.error('Manual mapping endpoint error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create manual mapping',
      error: `${error}`,
    });
  }
});

export default router;
