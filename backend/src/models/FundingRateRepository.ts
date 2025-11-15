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
    const { asset_id, timestamp, funding_rate, premium, platform, sampling_interval = '1h' } = params;

    const result = await query<FundingRate>(
      `INSERT INTO funding_rates (asset_id, timestamp, funding_rate, premium, platform, sampling_interval)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (asset_id, timestamp, platform, sampling_interval) DO UPDATE
       SET funding_rate = EXCLUDED.funding_rate, premium = EXCLUDED.premium
       RETURNING *`,
      [asset_id, timestamp, funding_rate, premium, platform, sampling_interval]
    );

    return result.rows[0];
  }

  /**
   * Bulk insert funding rates (efficient for large datasets)
   */
  async bulkInsert(records: CreateFundingRateParams[]): Promise<number> {
    if (records.length === 0) return 0;
    const chunkSize = Math.max(
      1,
      parseInt(process.env.FUNDING_RATE_INSERT_CHUNK_SIZE || '5000', 10)
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
        r.funding_rate,
        r.premium,
        r.platform,
        r.sampling_interval || '1h',
      ]);

      const result = await query(
        `INSERT INTO funding_rates (asset_id, timestamp, funding_rate, premium, platform, sampling_interval)
         VALUES ${values}
         ON CONFLICT (asset_id, timestamp, platform, sampling_interval) DO NOTHING`,
        params
      );

      const chunkInserted = result.rowCount || 0;
      inserted += chunkInserted;
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      logger.info(
        `Bulk insert progress: chunk ${chunkNumber}/${chunkCount} inserted ${chunkInserted} records (total ${inserted}/${records.length})`
      );
    }

    logger.info(`Bulk inserted ${inserted} funding rate records in ${chunkCount} chunk(s)`);
    return inserted;
  }

  /**
   * Query funding rates with filters
   */
  async find(params: FundingRateQuery): Promise<FundingRateWithAsset[]> {
    const { asset, startDate, endDate, platform, sampling_interval, limit = 1000, offset = 0 } = params;

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

    if (sampling_interval) {
      conditions.push(`fr.sampling_interval = $${paramIndex++}`);
      values.push(sampling_interval);
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
  async getLatestTimestamp(assetId: number, platform: string, samplingInterval: string = '1h'): Promise<Date | null> {
    const result = await query<{ timestamp: Date }>(
      `SELECT MAX(timestamp) as timestamp
       FROM funding_rates
       WHERE asset_id = $1 AND platform = $2 AND sampling_interval = $3`,
      [assetId, platform, samplingInterval]
    );

    return result.rows[0]?.timestamp || null;
  }

  /**
   * Get latest timestamps for multiple assets in a single query
   */
  async getLatestTimestamps(
    assetIds: number[],
    platform: string,
    samplingInterval: string = '1h'
  ): Promise<Map<number, Date>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const result = await query<{ asset_id: number; timestamp: Date }>(
      `SELECT asset_id, MAX(timestamp) as timestamp
       FROM funding_rates
       WHERE asset_id = ANY($1) AND platform = $2 AND sampling_interval = $3
       GROUP BY asset_id`,
      [assetIds, platform, samplingInterval]
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
   * Aggregate Hyperliquid hourly data into 8h records directly in SQL
   */
  async resampleHyperliquidTo8h(): Promise<{
    recordsCreated: number;
    assetsProcessed: number;
  }> {
    const result = await query<{ records_created: number; assets_processed: number }>(
      `WITH hourly AS (
        SELECT
          asset_id,
          date_trunc('hour', timestamp) AS hour_ts,
          funding_rate::numeric AS funding_rate,
          COALESCE(premium, '0')::numeric AS premium
        FROM funding_rates
        WHERE platform = 'hyperliquid' AND sampling_interval = '1h'
      ),
      buckets AS (
        SELECT
          asset_id,
          hour_ts - make_interval(hours => (EXTRACT(HOUR FROM hour_ts)::int % 8)) AS bucket_start,
          COUNT(DISTINCT hour_ts) AS bucket_count,
          SUM(funding_rate) AS funding_sum,
          AVG(premium) AS premium_avg
        FROM hourly
        GROUP BY asset_id, bucket_start
        HAVING COUNT(DISTINCT hour_ts) = 8
      ),
      inserted AS (
        INSERT INTO funding_rates (asset_id, timestamp, funding_rate, premium, platform, sampling_interval)
        SELECT
          b.asset_id,
          b.bucket_start,
          b.funding_sum,
          b.premium_avg,
          'hyperliquid',
          '8h'
        FROM buckets b
        LEFT JOIN funding_rates existing
          ON existing.asset_id = b.asset_id
         AND existing.timestamp = b.bucket_start
         AND existing.platform = 'hyperliquid'
         AND existing.sampling_interval = '8h'
        WHERE existing.id IS NULL
        RETURNING asset_id
      )
      SELECT
        COUNT(*)::int AS records_created,
        COUNT(DISTINCT asset_id)::int AS assets_processed
      FROM inserted`
    );

    const { records_created = 0, assets_processed = 0 } = result.rows[0] || {};
    return { recordsCreated: records_created, assetsProcessed: assets_processed };
  }

  /**
   * Get staleness info (days since last update) for all assets
   */
  async getAssetStaleness(platform: string): Promise<Map<number, number>> {
    const result = await query<{ asset_id: number; days_stale: number }>(
      `SELECT
        a.id as asset_id,
        COALESCE(
          EXTRACT(DAY FROM (NOW() - MAX(fr.timestamp)))::int,
          999
        ) as days_stale
       FROM assets a
       LEFT JOIN funding_rates fr ON a.id = fr.asset_id AND fr.platform = $1
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
