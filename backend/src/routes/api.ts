import { Router, Request, Response } from 'express';
import DataFetcherServiceInstance from '../services/dataFetcher';
import { DataFetcherService, ProgressEvent } from '../services/dataFetcher';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/fetch/stream
 * Server-Sent Events endpoint for initial data fetch with real-time progress
 */
router.get('/fetch/stream', async (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx

  // Flush headers to establish SSE connection
  res.flushHeaders();

  logger.info('SSE stream started for initial fetch');

  // Create a new DataFetcherService instance for this request
  const fetcher = new DataFetcherService();

  // Set up progress listener
  const progressListener = (event: ProgressEvent) => {
    logger.debug(`Progress event: ${event.type}, ${event.processedAssets}/${event.totalAssets}`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  fetcher.on('progress', progressListener);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  try {
    // Start the fetch
    await fetcher.fetchInitialData();

    // Close the connection
    res.write('data: {"type":"done"}\n\n');
    res.end();
  } catch (error) {
    logger.error('SSE fetch error', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: `${error}` })}\n\n`);
    res.end();
  } finally {
    fetcher.removeListener('progress', progressListener);
  }
});

/**
 * GET /api/fetch/incremental/stream
 * Server-Sent Events endpoint for incremental fetch with real-time progress
 */
router.get('/fetch/incremental/stream', async (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx

  // Flush headers to establish SSE connection
  res.flushHeaders();

  logger.info('SSE stream started for incremental fetch');

  // Create a new DataFetcherService instance for this request
  const fetcher = new DataFetcherService();

  // Set up progress listener
  const progressListener = (event: ProgressEvent) => {
    logger.debug(`Incremental progress event: ${event.type}, ${event.processedAssets}/${event.totalAssets}`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  fetcher.on('progress', progressListener);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  try {
    // Start the fetch
    await fetcher.fetchIncrementalData();

    // Close the connection
    res.write('data: {"type":"done"}\n\n');
    res.end();
  } catch (error) {
    logger.error('SSE incremental fetch error', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: `${error}` })}\n\n`);
    res.end();
  } finally {
    fetcher.removeListener('progress', progressListener);
  }
});

/**
 * POST /api/fetch
 * Manually trigger initial data fetch (without streaming)
 */
router.post('/fetch', async (req: Request, res: Response) => {
  try {
    logger.info('Manual fetch triggered');

    const fetcher = new DataFetcherService();
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
    logger.info('Manual incremental fetch triggered');

    const fetcher = new DataFetcherService();
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
 * GET /api/status
 * Get system status and last fetch information
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await DataFetcherServiceInstance.getStatus();

    res.json({
      success: true,
      data: status,
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

    res.json({
      success: true,
      data: assets,
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
 * Query params: asset, startDate, endDate, platform, limit, offset
 */
router.get('/funding-rates', async (req: Request, res: Response) => {
  try {
    const { asset, startDate, endDate, platform, limit, offset } = req.query;

    const query: any = {
      asset: asset as string,
      platform: platform as string,
      limit: limit ? parseInt(limit as string) : 1000,
      offset: offset ? parseInt(offset as string) : 0,
    };

    if (startDate) {
      query.startDate = new Date(startDate as string);
    }

    if (endDate) {
      query.endDate = new Date(endDate as string);
    }

    const fundingRates = await FundingRateRepository.find(query);

    res.json({
      success: true,
      data: fundingRates,
      count: fundingRates.length,
      query: {
        asset: query.asset || 'all',
        platform: query.platform || 'all',
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
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;
