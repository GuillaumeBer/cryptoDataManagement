import { Request, Response } from 'express';
import dataFetcherManager from '../services/dataFetcherManager';
import { logger } from '../utils/logger';
import createProgressStream from '../routes/createProgressStream';

export class SyncController {
  /**
   * GET /api/fetch/stream
   * Server-Sent Events endpoint for initial data fetch with real-time progress
   */
  static streamInitialFetch = createProgressStream('fetch/stream', async (fetcher) => fetcher.fetchInitialData());

  /**
   * GET /api/fetch/incremental/stream
   * Server-Sent Events endpoint for incremental fetch with real-time progress
   */
  static streamIncrementalFetch = createProgressStream('fetch/incremental/stream', async (fetcher) => fetcher.fetchIncrementalData());

  /**
   * POST /api/fetch
   * Manually trigger initial data fetch (without streaming)
   */
  static async manualFetch(req: Request, res: Response) {
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
  }

  /**
   * POST /api/fetch/incremental
   * Manually trigger incremental data fetch (without streaming)
   */
  static async manualIncrementalFetch(req: Request, res: Response) {
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
  }

  /**
   * POST /api/resample/hyperliquid-8h
   * Resample Hyperliquid 1-hour data to 8-hour intervals for comparison with Binance
   */
  static async resampleHyperliquid8h(_req: Request, res: Response) {
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
  }
}
