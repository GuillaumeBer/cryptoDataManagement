import { Router, Request, Response } from 'express';
import dataFetcherManager from '../services/dataFetcherManager';
import { getSchedulerStatus } from '../services/scheduler';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import UnifiedAssetRepository from '../models/UnifiedAssetRepository';
import AssetMappingRepository from '../models/AssetMappingRepository';
import assetMappingService from '../services/assetMappingService';
import { logger } from '../utils/logger';
import createProgressStream from './createProgressStream';

const router = Router();

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
router.post('/resample/hyperliquid-8h', async (req: Request, res: Response) => {
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
    const status = await fetcher.getStatus();
    const schedulerStatus = getSchedulerStatus();

    res.json({
      success: true,
      data: {
        ...status,
        scheduler: schedulerStatus,
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

/**
 * GET /api/funding-rates
 * Get funding rates with filters
 * Query params: asset, startDate, endDate, platform, sampling_interval, limit, offset
 */
router.get('/funding-rates', async (req: Request, res: Response) => {
  try {
    const { asset, startDate, endDate, platform, sampling_interval, limit, offset } = req.query;

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
      asset: asset as string,
      platform: platform as string,
      sampling_interval: sampling_interval as string,
      limit: limit ? parseInt(limit as string) : 1000,
      offset: offset ? parseInt(offset as string) : 0,
    };

    if (startDate) {
      query.startDate = new Date(startDate as string);
    }

    if (endDate) {
      query.endDate = new Date(endDate as string);
    }

    logger.debug('[API] Querying funding rates with', query);
    const fundingRates = await FundingRateRepository.find(query);
    logger.info('[API] Funding rates query completed', {
      asset,
      platform: query.platform,
      sampling_interval: query.sampling_interval,
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

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error('Analytics endpoint error', error);
    res.status(500).json({
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
router.get('/health', (req: Request, res: Response) => {
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
router.get('/unified-assets', async (req: Request, res: Response) => {
  try {
    const unifiedAssets = await UnifiedAssetRepository.findAllWithMappings();

    res.json({
      success: true,
      data: unifiedAssets,
      count: unifiedAssets.length,
    });
  } catch (error) {
    logger.error('Unified assets endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unified assets',
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

    res.json({
      success: true,
      data: unifiedAsset,
    });
  } catch (error) {
    logger.error('Unified asset endpoint error', error);
    res.status(500).json({
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
router.post('/unified-assets/generate-mappings', async (req: Request, res: Response) => {
  try {
    logger.info('Generating asset mappings');

    const result = await assetMappingService.generateMappings();

    res.json({
      success: true,
      message: 'Asset mappings generated',
      data: result,
    });
  } catch (error) {
    logger.error('Generate mappings endpoint error', error);
    res.status(500).json({
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

    res.json({
      success: result,
      message: result ? 'Manual mapping created' : 'Failed to create manual mapping',
    });
  } catch (error) {
    logger.error('Manual mapping endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create manual mapping',
      error: `${error}`,
    });
  }
});

export default router;
