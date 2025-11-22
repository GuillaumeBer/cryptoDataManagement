import { query } from '../database/connection';
import {
  LongShortRatio,
  LongShortRatioWithAsset,
  LongShortRatioQuery,
  CreateLongShortRatioParams,
} from './types';
import { logger } from '../utils/logger';

export class LongShortRatioRepository {
  /**
   * Create a single long/short ratio record
   */
  async create(params: CreateLongShortRatioParams): Promise<LongShortRatio> {
    const {
      asset_id,
      timestamp,
      long_ratio,
      short_ratio,
      long_account,
      short_account,
      platform,
      type,
      period,
    } = params;

    const result = await query<LongShortRatio>(
      `INSERT INTO long_short_ratios (
         asset_id, timestamp, long_ratio, short_ratio, long_account, short_account, platform, type, period
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (asset_id, timestamp, platform, type, period) DO UPDATE
       SET long_ratio = EXCLUDED.long_ratio,
           short_ratio = EXCLUDED.short_ratio,
           long_account = EXCLUDED.long_account,
           short_account = EXCLUDED.short_account
       RETURNING *`,
      [
        asset_id,
        timestamp,
        long_ratio,
        short_ratio,
        long_account || null,
        short_account || null,
        platform,
        type,
        period,
      ]
    );

    return result.rows[0];
  }

  /**
   * Bulk insert long/short ratios (efficient for large datasets)
   */
  async bulkUpsert(records: CreateLongShortRatioParams[]): Promise<number> {
    if (records.length === 0) return 0;
    const chunkSize = Math.max(
      1,
      parseInt(process.env.LS_RATIO_INSERT_CHUNK_SIZE || '5000', 10)
    );
    const chunkCount = Math.ceil(records.length / chunkSize);
    let inserted = 0;

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const values = chunk
        .map(
          (_, idx) =>
            `($${idx * 9 + 1}, $${idx * 9 + 2}, $${idx * 9 + 3}, $${idx * 9 + 4}, $${idx * 9 + 5}, $${idx * 9 + 6}, $${idx * 9 + 7}, $${idx * 9 + 8}, $${idx * 9 + 9})`
        )
        .join(', ');

      const params = chunk.flatMap((r) => [
        r.asset_id,
        r.timestamp,
        r.long_ratio,
        r.short_ratio,
        r.long_account || null,
        r.short_account || null,
        r.platform,
        r.type,
        r.period,
      ]);

      const result = await query(
        `INSERT INTO long_short_ratios (
           asset_id, timestamp, long_ratio, short_ratio, long_account, short_account, platform, type, period
         )
         VALUES ${values}
         ON CONFLICT (asset_id, timestamp, platform, type, period) DO UPDATE
         SET long_ratio = EXCLUDED.long_ratio,
             short_ratio = EXCLUDED.short_ratio,
             long_account = EXCLUDED.long_account,
             short_account = EXCLUDED.short_account`,
        params
      );

      const chunkInserted = result.rowCount || 0;
      inserted += chunkInserted;
    }

    logger.info(`Bulk upserted ${inserted} long/short ratio records in ${chunkCount} chunk(s)`);
    return inserted;
  }

  /**
   * Query long/short ratios with filters
   */
  async find(params: LongShortRatioQuery): Promise<LongShortRatioWithAsset[]> {
    const {
      asset,
      startDate,
      endDate,
      platform,
      timeframe,
      type,
      limit = 1000,
      offset = 0,
    } = params;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (asset) {
      conditions.push(`a.symbol = $${paramIndex++}`);
      values.push(asset);
    }

    if (platform) {
      conditions.push(`ls.platform = $${paramIndex++}`);
      values.push(platform);
    }

    if (timeframe) {
      conditions.push(`ls.period = $${paramIndex++}`);
      values.push(timeframe);
    }

    if (type) {
      conditions.push(`ls.type = $${paramIndex++}`);
      values.push(type);
    }

    if (startDate) {
      conditions.push(`ls.timestamp >= $${paramIndex++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`ls.timestamp <= $${paramIndex++}`);
      values.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        ls.id,
        ls.asset_id,
        ls.timestamp,
        ls.long_account,
        ls.short_account,
        ls.long_ratio AS long_short_ratio,
        ls.long_ratio,
        ls.short_ratio,
        ls.platform,
        ls.type,
        ls.period AS timeframe,
        ls.period,
        ls.created_at AS fetched_at,
        a.symbol as asset_symbol,
        a.name as asset_name
      FROM long_short_ratios ls
      JOIN assets a ON ls.asset_id = a.id
      ${whereClause}
      ORDER BY ls.timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    values.push(limit, offset);

    const result = await query<LongShortRatioWithAsset>(sql, values);
    return result.rows;
  }

  /**
   * Get latest timestamp for an asset
   */
  async getLatestTimestamp(
    assetId: number,
    platform: string,
    type: string,
    period: string
  ): Promise<Date | null> {
    const result = await query<{ timestamp: Date }>(
      `SELECT MAX(timestamp) as timestamp
       FROM long_short_ratios
       WHERE asset_id = $1 AND platform = $2 AND type = $3 AND period = $4`,
      [assetId, platform, type, period]
    );

    return result.rows[0]?.timestamp || null;
  }

  /**
   * Count total records for a platform
   */
  async count(platform: string): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM long_short_ratios WHERE platform = $1',
      [platform]
    );
    return parseInt(result.rows[0].count, 10);
  }
}

export default new LongShortRatioRepository();
