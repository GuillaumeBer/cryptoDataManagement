import { query } from '../database/connection';
import {
  FundingRate,
  FundingRateWithAsset,
  FundingRateQuery,
  AssetAnalytics,
  CreateFundingRateParams,
} from './types';
import { logger } from '../utils/logger';

export class FundingRateRepository {
  /**
   * Create a single funding rate record
   */
  async create(params: CreateFundingRateParams): Promise<FundingRate> {
    const { asset_id, timestamp, funding_rate, premium, platform } = params;

    const result = await query<FundingRate>(
      `INSERT INTO funding_rates (asset_id, timestamp, funding_rate, premium, platform)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (asset_id, timestamp, platform) DO UPDATE
       SET funding_rate = EXCLUDED.funding_rate, premium = EXCLUDED.premium
       RETURNING *`,
      [asset_id, timestamp, funding_rate, premium, platform]
    );

    return result.rows[0];
  }

  /**
   * Bulk insert funding rates (efficient for large datasets)
   */
  async bulkInsert(records: CreateFundingRateParams[]): Promise<number> {
    if (records.length === 0) return 0;

    const values = records
      .map(
        (_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
      )
      .join(', ');

    const params = records.flatMap((r) => [
      r.asset_id,
      r.timestamp,
      r.funding_rate,
      r.premium,
      r.platform,
    ]);

    const result = await query(
      `INSERT INTO funding_rates (asset_id, timestamp, funding_rate, premium, platform)
       VALUES ${values}
       ON CONFLICT (asset_id, timestamp, platform) DO NOTHING`,
      params
    );

    const inserted = result.rowCount || 0;
    logger.info(`Bulk inserted ${inserted} funding rate records`);
    return inserted;
  }

  /**
   * Query funding rates with filters
   */
  async find(params: FundingRateQuery): Promise<FundingRateWithAsset[]> {
    const { asset, startDate, endDate, platform, limit = 1000, offset = 0 } = params;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (asset) {
      conditions.push(`a.symbol = $${paramIndex++}`);
      values.push(asset);
    }

    if (platform) {
      conditions.push(`fr.platform = $${paramIndex++}`);
      values.push(platform);
    }

    if (startDate) {
      conditions.push(`fr.timestamp >= $${paramIndex++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`fr.timestamp <= $${paramIndex++}`);
      values.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        fr.*,
        a.symbol as asset_symbol,
        a.name as asset_name
      FROM funding_rates fr
      JOIN assets a ON fr.asset_id = a.id
      ${whereClause}
      ORDER BY fr.timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    values.push(limit, offset);

    const result = await query<FundingRateWithAsset>(sql, values);
    return result.rows;
  }

  /**
   * Get latest timestamp for an asset
   */
  async getLatestTimestamp(assetId: number, platform: string): Promise<Date | null> {
    const result = await query<{ timestamp: Date }>(
      `SELECT MAX(timestamp) as timestamp
       FROM funding_rates
       WHERE asset_id = $1 AND platform = $2`,
      [assetId, platform]
    );

    return result.rows[0]?.timestamp || null;
  }

  /**
   * Get analytics for a specific asset
   */
  async getAssetAnalytics(symbol: string, platform: string): Promise<AssetAnalytics | null> {
    const result = await query<AssetAnalytics>(
      `SELECT
        a.symbol,
        a.platform,
        COUNT(fr.id)::int as total_records,
        AVG(fr.funding_rate) as avg_funding_rate,
        MIN(fr.funding_rate) as min_funding_rate,
        MAX(fr.funding_rate) as max_funding_rate,
        STDDEV(fr.funding_rate) as std_dev,
        MIN(fr.timestamp) as first_timestamp,
        MAX(fr.timestamp) as last_timestamp,
        COUNT(CASE WHEN fr.funding_rate > 0 THEN 1 END)::int as positive_count,
        COUNT(CASE WHEN fr.funding_rate < 0 THEN 1 END)::int as negative_count
      FROM assets a
      LEFT JOIN funding_rates fr ON a.id = fr.asset_id
      WHERE a.symbol = $1 AND a.platform = $2
      GROUP BY a.symbol, a.platform`,
      [symbol, platform]
    );

    return result.rows[0] || null;
  }

  /**
   * Get total count of funding rate records
   */
  async count(platform?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM funding_rates';
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
      `DELETE FROM funding_rates
       WHERE timestamp < NOW() - INTERVAL '${days} days'`
    );

    logger.info(`Deleted ${result.rowCount} old funding rate records`);
    return result.rowCount || 0;
  }
}

export default new FundingRateRepository();
