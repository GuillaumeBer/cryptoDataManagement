import { query } from '../database/connection';
import { Asset, CreateAssetParams } from './types';
import { logger } from '../utils/logger';

export class AssetRepository {
  /**
   * Find asset by symbol and platform
   */
  async findBySymbol(symbol: string, platform: string): Promise<Asset | null> {
    const result = await query<Asset>(
      'SELECT * FROM assets WHERE symbol = $1 AND platform = $2',
      [symbol, platform]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all assets for a platform
   */
  async findByPlatform(platform: string): Promise<Asset[]> {
    const result = await query<Asset>(
      'SELECT * FROM assets WHERE platform = $1 ORDER BY symbol',
      [platform]
    );

    return result.rows;
  }

  /**
   * Get all active assets
   */
  async findAllActive(): Promise<Asset[]> {
    const result = await query<Asset>(
      'SELECT * FROM assets WHERE is_active = true ORDER BY platform, symbol'
    );

    return result.rows;
  }

  /**
   * Create a new asset
   */
  async create(params: CreateAssetParams): Promise<Asset> {
    const { symbol, platform, name } = params;

    const result = await query<Asset>(
      `INSERT INTO assets (symbol, platform, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (symbol) DO UPDATE
       SET name = EXCLUDED.name, updated_at = NOW(), is_active = true
       RETURNING *`,
      [symbol, platform, name || symbol]
    );

    logger.info(`Asset created/updated: ${symbol} on ${platform}`);
    return result.rows[0];
  }

  /**
   * Bulk create or update assets
   */
  async bulkUpsert(assets: CreateAssetParams[]): Promise<number> {
    if (assets.length === 0) return 0;

    const values = assets
      .map(
        (_, i) =>
          `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
      )
      .join(', ');

    const params = assets.flatMap((a) => [a.symbol, a.platform, a.name || a.symbol]);

    const result = await query(
      `INSERT INTO assets (symbol, platform, name)
       VALUES ${values}
       ON CONFLICT (symbol) DO UPDATE
       SET name = EXCLUDED.name, updated_at = NOW(), is_active = true`,
      params
    );

    logger.info(`Bulk upserted ${result.rowCount} assets`);
    return result.rowCount || 0;
  }

  /**
   * Get asset count
   */
  async count(platform?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM assets';
    const params: any[] = [];

    if (platform) {
      sql += ' WHERE platform = $1';
      params.push(platform);
    }

    const result = await query<{ count: string }>(sql, params);
    return parseInt(result.rows[0].count);
  }
}

export default new AssetRepository();
