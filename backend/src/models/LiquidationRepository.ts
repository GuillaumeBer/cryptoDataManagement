import { Pool, QueryResult } from 'pg';
import { getPool, query } from '../database/connection';
import { logger } from '../utils/logger';
import { LiquidationRecord, CreateLiquidationParams } from './types';

export class LiquidationRepository {
  /**
   * Create a new liquidation record
   */
  async create(params: CreateLiquidationParams): Promise<LiquidationRecord> {
    const text = `
      INSERT INTO liquidations (
        asset_id, timestamp, side, price, quantity, volume_usd, platform, fetched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `;

    const values = [
      params.asset_id,
      new Date(params.timestamp),
      params.side,
      params.price,
      params.quantity,
      params.volume_usd,
      params.platform,
    ];

    const result = await query<LiquidationRecord>(text, values);
    return result.rows[0];
  }

  /**
   * Bulk insert liquidation records
   * Uses ON CONFLICT DO NOTHING to skip duplicates
   */
  async bulkInsert(records: CreateLiquidationParams[]): Promise<number> {
    if (records.length === 0) return 0;

    const client = await getPool().connect();

    try {
      await client.query('BEGIN');

      // Process in batches to avoid query size limits
      const batchSize = 1000;
      let insertedCount = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        // Construct values string for bulk insert
        const values: any[] = [];
        const placeholders: string[] = [];
        
        batch.forEach((record, index) => {
          const offset = index * 7;
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, NOW())`);
          values.push(
            record.asset_id,
            new Date(record.timestamp),
            record.side,
            record.price,
            record.quantity,
            record.volume_usd,
            record.platform
          );
        });

        const text = `
          INSERT INTO liquidations (
            asset_id, timestamp, side, price, quantity, volume_usd, platform, fetched_at
          )
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (asset_id, platform, timestamp, side, price, quantity) DO NOTHING
        `;

        const result = await client.query(text, values);
        insertedCount += result.rowCount || 0;
      }

      await client.query('COMMIT');
      return insertedCount;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to bulk insert liquidations', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find liquidations by asset and time range
   */
  async find(params: {
    assetId?: number;
    platform?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<LiquidationRecord[]> {
    let text = `
      SELECT l.*, a.symbol as asset_symbol, a.name as asset_name
      FROM liquidations l
      JOIN assets a ON l.asset_id = a.id
      WHERE 1=1
    `;
    const values: any[] = [];
    let paramCount = 1;

    if (params.assetId) {
      text += ` AND l.asset_id = $${paramCount}`;
      values.push(params.assetId);
      paramCount++;
    }

    if (params.platform) {
      text += ` AND l.platform = $${paramCount}`;
      values.push(params.platform);
      paramCount++;
    }

    if (params.startDate) {
      text += ` AND l.timestamp >= $${paramCount}`;
      values.push(params.startDate);
      paramCount++;
    }

    if (params.endDate) {
      text += ` AND l.timestamp <= $${paramCount}`;
      values.push(params.endDate);
      paramCount++;
    }

    text += ` ORDER BY l.timestamp DESC`;

    if (params.limit) {
      text += ` LIMIT $${paramCount}`;
      values.push(params.limit);
      paramCount++;
    }

    if (params.offset) {
      text += ` OFFSET $${paramCount}`;
      values.push(params.offset);
      paramCount++;
    }

    const result = await query<LiquidationRecord>(text, values);
    return result.rows;
  }

  /**
   * Get latest timestamp for each asset on a platform
   */
  async getLatestTimestamps(platform: string): Promise<Map<number, number>> {
    const text = `
      SELECT asset_id, MAX(timestamp) as max_timestamp
      FROM liquidations
      WHERE platform = $1
      GROUP BY asset_id
    `;

    const result = await query<{ asset_id: number; max_timestamp: Date }>(text, [platform]);
    
    const map = new Map<number, number>();
    result.rows.forEach((row) => {
      map.set(row.asset_id, new Date(row.max_timestamp).getTime());
    });

    return map;
  }
}

export const liquidationRepository = new LiquidationRepository();
