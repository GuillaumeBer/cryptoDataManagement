import { query } from '../database/connection';
import {
  OpenInterest,
  OpenInterestWithAsset,
  OpenInterestQuery,
  CreateOpenInterestParams,
} from './types';
import { logger } from '../utils/logger';

export class OpenInterestRepository {
  /**
   * Create a single open interest record
   */
  async create(params: CreateOpenInterestParams): Promise<OpenInterest> {
    const { asset_id, timestamp, timeframe = '1h', open_interest, open_interest_value, platform } = params;

    const result = await query<OpenInterest>(
      `INSERT INTO open_interest_data (asset_id, timestamp, timeframe, open_interest, open_interest_value, platform)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (asset_id, timestamp, platform, timeframe) DO UPDATE
       SET open_interest = EXCLUDED.open_interest, open_interest_value = EXCLUDED.open_interest_value
       RETURNING *`,
      [asset_id, timestamp, timeframe, open_interest, open_interest_value, platform]
    );

    return result.rows[0];
  }

  /**
   * Bulk insert open interest records (efficient for large datasets)
   */
  async bulkInsert(records: CreateOpenInterestParams[]): Promise<number> {
    if (records.length === 0) return 0;
    const chunkSize = Math.max(
      1,
      parseInt(process.env.OPEN_INTEREST_INSERT_CHUNK_SIZE || '5000', 10)
    );
    const chunkCount = Math.ceil(records.length / chunkSize);
    let inserted = 0;

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const values = chunk
        .map(
          (_, idx) =>
            `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`
        )
        .join(', ');

      const params = chunk.flatMap((r) => [
        r.asset_id,
        r.timestamp,
        r.timeframe || '1h',
        r.open_interest,
        r.open_interest_value || null,
        r.platform,
      ]);

      const result = await query(
        `INSERT INTO open_interest_data (asset_id, timestamp, timeframe, open_interest, open_interest_value, platform)
         VALUES ${values}
         ON CONFLICT (asset_id, timestamp, platform, timeframe) DO UPDATE
         SET open_interest = EXCLUDED.open_interest,
             open_interest_value = COALESCE(EXCLUDED.open_interest_value, open_interest_data.open_interest_value)`,
        params
      );

      const chunkInserted = result.rowCount || 0;
      inserted += chunkInserted;
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      logger.info(
        `Bulk insert progress: chunk ${chunkNumber}/${chunkCount} inserted ${chunkInserted} records (total ${inserted}/${records.length})`
      );
    }

    logger.info(`Bulk inserted ${inserted} open interest records in ${chunkCount} chunk(s)`);
    return inserted;
  }

  /**
   * Query open interest with filters
   */
  async find(params: OpenInterestQuery): Promise<OpenInterestWithAsset[]> {
    const { asset, assetId, startDate, endDate, platform, timeframe, limit = 1000, offset = 0 } = params;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (asset) {
      conditions.push(`a.symbol = $${paramIndex++}`);
      values.push(asset);
    }

    if (assetId) {
      conditions.push(`oi.asset_id = $${paramIndex++}`);
      values.push(assetId);
    }

    if (platform) {
      conditions.push(`oi.platform = $${paramIndex++}`);
      values.push(platform);
    }

    if (timeframe) {
      conditions.push(`oi.timeframe = $${paramIndex++}`);
      values.push(timeframe);
    }

    if (startDate) {
      conditions.push(`oi.timestamp >= $${paramIndex++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`oi.timestamp <= $${paramIndex++}`);
      values.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        oi.*,
        a.symbol as asset_symbol,
        a.name as asset_name
      FROM open_interest_data oi
      JOIN assets a ON oi.asset_id = a.id
      ${whereClause}
      ORDER BY oi.timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    values.push(limit, offset);

    const result = await query<OpenInterestWithAsset>(sql, values);
    return result.rows;
  }

  /**
   * Get latest timestamp for an asset
   */
  async getLatestTimestamp(assetId: number, platform: string, timeframe: string = '1h'): Promise<Date | null> {
    const result = await query<{ timestamp: Date }>(
      `SELECT MAX(timestamp) as timestamp
       FROM open_interest_data
       WHERE asset_id = $1 AND platform = $2 AND timeframe = $3`,
      [assetId, platform, timeframe]
    );

    return result.rows[0]?.timestamp || null;
  }

  /**
   * Get latest timestamps for multiple assets in a single query
   */
  async getLatestTimestamps(
    assetIds: number[],
    platform: string,
    timeframe: string = '1h'
  ): Promise<Map<number, Date>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const result = await query<{ asset_id: number; timestamp: Date }>(
      `SELECT asset_id, MAX(timestamp) as timestamp
       FROM open_interest_data
       WHERE asset_id = ANY($1) AND platform = $2 AND timeframe = $3
       GROUP BY asset_id`,
      [assetIds, platform, timeframe]
    );

    const timestamps = new Map<number, Date>();
    for (const row of result.rows) {
      if (row.timestamp) {
        timestamps.set(row.asset_id, row.timestamp);
      }
    }

    return timestamps;
  }

  /**
   * Get total count of open interest records
   */
  async count(platform?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM open_interest_data';
    const params: any[] = [];

    if (platform) {
      sql += ' WHERE platform = $1';
      params.push(platform);
    }

    const result = await query<{ count: string }>(sql, params);
    return parseInt(result.rows[0].count);
  }

  /**
   * Delete old records (for maintenance)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const result = await query(
      `DELETE FROM open_interest_data
       WHERE timestamp < NOW() - INTERVAL '${days} days'`
    );

    logger.info(`Deleted ${result.rowCount} old open interest records`);
    return result.rowCount || 0;
  }

  /**
   * Get staleness info (days since last update) for all assets
   */
  async getAssetStaleness(platform: string): Promise<Map<number, number>> {
    const result = await query<{ asset_id: number; days_stale: number }>(
      `SELECT
        a.id as asset_id,
        COALESCE(
          EXTRACT(DAY FROM (NOW() - MAX(oi.timestamp)))::int,
          999
        ) as days_stale
       FROM assets a
       LEFT JOIN open_interest_data oi ON a.id = oi.asset_id AND oi.platform = $1
       WHERE a.platform = $1
       GROUP BY a.id`,
      [platform]
    );

    const stalenessMap = new Map<number, number>();
    for (const row of result.rows) {
      stalenessMap.set(row.asset_id, row.days_stale);
    }

    return stalenessMap;
  }
}

export default new OpenInterestRepository();
