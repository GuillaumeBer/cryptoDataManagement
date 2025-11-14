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
  res.setHeader('Transfer-Encoding', 'chunked');

  // Disable socket buffering
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);

  // Flush headers to establish SSE connection
  res.flushHeaders();

  logger.info('SSE stream started for initial fetch');

  // Use the singleton instance
  const fetcher = DataFetcherServiceInstance;

  // Set up progress listener that closes connection on completion
  const progressListener = (event: ProgressEvent) => {
    console.log(`[SSE] Received progress event: ${event.type}, ${event.processedAssets}/${event.totalAssets}`);
    logger.debug(`Progress event: ${event.type}, ${event.processedAssets}/${event.totalAssets}`);
    const written = res.write(`data: ${JSON.stringify(event)}\n\n`);
    console.log(`[SSE] Write returned: ${written}`);

    // Close connection when fetch completes or errors
    if (event.type === 'complete' || event.type === 'error') {
      res.write('data: {"type":"done"}\n\n');
      res.end();
      fetcher.removeListener('progress', progressListener);
    }
  };

  console.log('[SSE] Setting up progress listener...');
  fetcher.on('progress', progressListener);
  console.log('[SSE] Progress listener attached.');

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // If there's already progress, send it immediately
  const currentProgress = fetcher.getCurrentProgress();
  if (currentProgress) {
    console.log('[SSE] Reconnecting to ongoing fetch, sending current progress');
    res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log('[SSE] Client disconnected, removing listener');
    fetcher.removeListener('progress', progressListener);
  });

  try {
    // Only start a new fetch if none is in progress
    if (!fetcher.isFetchInProgress()) {
      console.log('[SSE] Starting new fetch...');
      await fetcher.fetchInitialData();
      // Note: Connection will be closed by progressListener on complete event
    } else {
      console.log('[SSE] Fetch already in progress, listening for updates...');
      // Keep connection open - progressListener will close it on completion
    }
  } catch (error) {
    logger.error('SSE fetch error', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: `${error}` })}\n\n`);
    res.end();
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

  // Use the singleton instance
  const fetcher = DataFetcherServiceInstance;

  // Set up progress listener that closes connection on completion
  const progressListener = (event: ProgressEvent) => {
    logger.debug(`Incremental progress event: ${event.type}, ${event.processedAssets}/${event.totalAssets}`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Close connection when fetch completes or errors
    if (event.type === 'complete' || event.type === 'error') {
      res.write('data: {"type":"done"}\n\n');
      res.end();
      fetcher.removeListener('progress', progressListener);
    }
  };

  fetcher.on('progress', progressListener);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // If there's already progress, send it immediately
  const currentProgress = fetcher.getCurrentProgress();
  if (currentProgress) {
    res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
  }

  // Handle client disconnect
  req.on('close', () => {
    fetcher.removeListener('progress', progressListener);
  });

  try {
    // Only start a new fetch if none is in progress
    if (!fetcher.isFetchInProgress()) {
      await fetcher.fetchIncrementalData();
      // Note: Connection will be closed by progressListener on complete event
    }
    // If fetch is already in progress, progressListener will close connection on completion
  } catch (error) {
    logger.error('SSE incremental fetch error', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: `${error}` })}\n\n`);
    res.end();
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

    const result = await DataFetcherServiceInstance.fetchInitialData();

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

    const result = await DataFetcherServiceInstance.fetchIncrementalData();

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
