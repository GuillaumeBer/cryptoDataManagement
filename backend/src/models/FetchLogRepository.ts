import { query } from '../database/connection';
import { FetchLog } from './types';
import { logger } from '../utils/logger';

export class FetchLogRepository {
  /**
   * Create a new fetch log entry
   */
  async create(
    platform: string,
    fetchType: 'initial' | 'incremental'
  ): Promise<FetchLog> {
    const result = await query<FetchLog>(
      `INSERT INTO fetch_logs (platform, fetch_type, status, started_at)
       VALUES ($1, $2, 'running', NOW())
       RETURNING *`,
      [platform, fetchType]
    );

    return result.rows[0];
  }

  /**
   * Update fetch log with completion status
   */
  async complete(
    id: number,
    status: 'success' | 'failed' | 'partial',
    assetsProcessed: number,
    recordsFetched: number,
    errorMessage?: string
  ): Promise<void> {
    await query(
      `UPDATE fetch_logs
       SET status = $1,
           assets_processed = $2,
           records_fetched = $3,
           error_message = $4,
           completed_at = NOW()
       WHERE id = $5`,
      [status, assetsProcessed, recordsFetched, errorMessage || null, id]
    );

    logger.info(`Fetch log ${id} completed with status: ${status}`);
  }

  /**
   * Get recent fetch logs
   */
  async getRecent(limit: number = 10): Promise<FetchLog[]> {
    const result = await query<FetchLog>(
      `SELECT * FROM fetch_logs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }

  /**
   * Get recent failed or partial fetch logs (optionally filtered by platform)
   */
  async getRecentErrors(platform?: string, limit: number = 5): Promise<FetchLog[]> {
    const params: Array<string | number> = [];
    let whereClause = "WHERE (status = 'failed' OR status = 'partial' OR error_message IS NOT NULL)";

    if (platform) {
      params.push(platform);
      whereClause += ` AND platform = $${params.length}`;
    }

    params.push(limit);
    const limitPosition = params.length;

    const result = await query<FetchLog>(
      `SELECT * FROM fetch_logs
       ${whereClause}
       ORDER BY started_at DESC
       LIMIT $${limitPosition}`,
      params
    );

    return result.rows;
  }

  /**
   * Get last successful fetch for a platform
   */
  async getLastSuccessful(platform: string): Promise<FetchLog | null> {
    const result = await query<FetchLog>(
      `SELECT * FROM fetch_logs
       WHERE platform = $1 AND status = 'success'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [platform]
    );

    return result.rows[0] || null;
  }
}

export default new FetchLogRepository();
