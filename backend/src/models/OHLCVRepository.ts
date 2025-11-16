import { query } from '../database/connection';
import {
  OHLCVData,
  OHLCVDataWithAsset,
  OHLCVQuery,
  CreateOHLCVParams,
} from './types';
import { logger } from '../utils/logger';

export class OHLCVRepository {
  /**
   * Create a single OHLCV record
   */
  async create(params: CreateOHLCVParams): Promise<OHLCVData> {
    const {
      asset_id,
      timestamp,
      timeframe,
      open,
      high,
      low,
      close,
      volume,
      quote_volume,
      trades_count,
      platform,
    } = params;

    const result = await query<OHLCVData>(
      `INSERT INTO ohlcv_data (asset_id, timestamp, timeframe, open, high, low, close, volume, quote_volume, trades_count, platform)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (asset_id, timestamp, platform, timeframe) DO UPDATE
       SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
           volume = EXCLUDED.volume, quote_volume = EXCLUDED.quote_volume, trades_count = EXCLUDED.trades_count
       RETURNING *`,
      [asset_id, timestamp, timeframe, open, high, low, close, volume, quote_volume, trades_count, platform]
    );

    return result.rows[0];
  }

  /**
   * Bulk insert OHLCV data (efficient for large datasets)
   */
  async bulkInsert(records: CreateOHLCVParams[]): Promise<number> {
    if (records.length === 0) return 0;
    const chunkSize = Math.max(
      1,
      parseInt(process.env.OHLCV_INSERT_CHUNK_SIZE || '5000', 10)
    );
    const chunkCount = Math.ceil(records.length / chunkSize);
    let inserted = 0;

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const values = chunk
        .map(
          (_, idx) =>
            `($${idx * 11 + 1}, $${idx * 11 + 2}, $${idx * 11 + 3}, $${idx * 11 + 4}, $${idx * 11 + 5}, $${idx * 11 + 6}, $${idx * 11 + 7}, $${idx * 11 + 8}, $${idx * 11 + 9}, $${idx * 11 + 10}, $${idx * 11 + 11})`
        )
        .join(', ');

      const params = chunk.flatMap((r) => [
        r.asset_id,
        r.timestamp,
        r.timeframe,
        r.open,
        r.high,
        r.low,
        r.close,
        r.volume || null,
        r.quote_volume || null,
        r.trades_count || null,
        r.platform,
      ]);

      const result = await query(
        `INSERT INTO ohlcv_data (asset_id, timestamp, timeframe, open, high, low, close, volume, quote_volume, trades_count, platform)
         VALUES ${values}
         ON CONFLICT (asset_id, timestamp, platform, timeframe) DO NOTHING`,
        params
      );

      const chunkInserted = result.rowCount || 0;
      inserted += chunkInserted;
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      logger.info(
        `Bulk insert progress: chunk ${chunkNumber}/${chunkCount} inserted ${chunkInserted} records (total ${inserted}/${records.length})`
      );
    }

    logger.info(`Bulk inserted ${inserted} OHLCV records in ${chunkCount} chunk(s)`);
    return inserted;
  }

  /**
   * Query OHLCV data with filters
   */
  async find(params: OHLCVQuery): Promise<OHLCVDataWithAsset[]> {
    const { asset, startDate, endDate, platform, timeframe, limit = 1000, offset = 0 } = params;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (asset) {
      conditions.push(`a.symbol = $${paramIndex++}`);
      values.push(asset);
    }

    if (platform) {
      conditions.push(`o.platform = $${paramIndex++}`);
      values.push(platform);
    }

    if (timeframe) {
      conditions.push(`o.timeframe = $${paramIndex++}`);
      values.push(timeframe);
    }

    if (startDate) {
      conditions.push(`o.timestamp >= $${paramIndex++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`o.timestamp <= $${paramIndex++}`);
      values.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        o.*,
        a.symbol as asset_symbol,
        a.name as asset_name
      FROM ohlcv_data o
      JOIN assets a ON o.asset_id = a.id
      ${whereClause}
      ORDER BY o.timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    values.push(limit, offset);

    const result = await query<OHLCVDataWithAsset>(sql, values);
    return result.rows;
  }

  /**
   * Get latest timestamp for an asset
   */
  async getLatestTimestamp(assetId: number, platform: string, timeframe: string = '1h'): Promise<Date | null> {
    const result = await query<{ timestamp: Date }>(
      `SELECT MAX(timestamp) as timestamp
       FROM ohlcv_data
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
       FROM ohlcv_data
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
   * Get total count of OHLCV records
   */
  async count(platform?: string, timeframe?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM ohlcv_data';
    const params: any[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (platform) {
      conditions.push(`platform = $${paramIndex++}`);
      params.push(platform);
    }

    if (timeframe) {
      conditions.push(`timeframe = $${paramIndex++}`);
      params.push(timeframe);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    const result = await query<{ count: string }>(sql, params);
    return parseInt(result.rows[0].count);
  }

  /**
   * Delete old records (for maintenance)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const result = await query(
      `DELETE FROM ohlcv_data
       WHERE timestamp < NOW() - INTERVAL '${days} days'`
    );

    logger.info(`Deleted ${result.rowCount} old OHLCV records`);
    return result.rowCount || 0;
  }

  /**
   * Get staleness info (days since last update) for all assets
   */
  async getAssetStaleness(platform: string, timeframe: string = '1h'): Promise<Map<number, number>> {
    const result = await query<{ asset_id: number; days_stale: number }>(
      `SELECT
        a.id as asset_id,
        COALESCE(
          EXTRACT(DAY FROM (NOW() - MAX(o.timestamp)))::int,
          999
        ) as days_stale
       FROM assets a
       LEFT JOIN ohlcv_data o ON a.id = o.asset_id AND o.platform = $1 AND o.timeframe = $2
       WHERE a.platform = $1
       GROUP BY a.id`,
      [platform, timeframe]
    );

    const stalenessMap = new Map<number, number>();
    for (const row of result.rows) {
      stalenessMap.set(row.asset_id, row.days_stale);
    }

    return stalenessMap;
  }
}

export default new OHLCVRepository();
