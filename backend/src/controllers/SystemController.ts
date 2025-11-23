import { Request, Response } from 'express';
import dataFetcherManager from '../services/dataFetcherManager';
import { getSchedulerStatus } from '../services/scheduler';
import FetchLogRepository from '../models/FetchLogRepository';
import { logger } from '../utils/logger';

export class SystemController {
  /**
   * GET /api/status
   * Get system status and last fetch information
   */
  static async getStatus(req: Request, res: Response) {
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
  }

  /**
   * GET /api/logs
   * Get recent fetch logs
   */
  static async getLogs(req: Request, res: Response) {
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
  }

  /**
   * GET /api/health
   * Health check endpoint
   */
  static getHealth(_req: Request, res: Response) {
    const schedulerStatus = getSchedulerStatus();
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      scheduler: schedulerStatus,
    });
  }
}
