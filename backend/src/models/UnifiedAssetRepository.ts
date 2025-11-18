import { query } from '../database/connection';
import { UnifiedAsset, CreateUnifiedAssetParams, UnifiedAssetWithMappings } from './types';
import { logger } from '../utils/logger';

export class UnifiedAssetRepository {
  /**
   * Find unified asset by normalized symbol
   */
  async findByNormalizedSymbol(normalizedSymbol: string): Promise<UnifiedAsset | null> {
    const result = await query<UnifiedAsset>(
      'SELECT * FROM unified_assets WHERE normalized_symbol = $1',
      [normalizedSymbol]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all unified assets
   */
  async findAll(): Promise<UnifiedAsset[]> {
    const result = await query<UnifiedAsset>(
      'SELECT * FROM unified_assets ORDER BY normalized_symbol'
    );

    return result.rows;
  }

  /**
   * Get unified asset with all its platform mappings
   */
  async findWithMappings(unifiedAssetId: number): Promise<UnifiedAssetWithMappings | null> {
    // Get unified asset
    const assetResult = await query<UnifiedAsset>(
      'SELECT * FROM unified_assets WHERE id = $1',
      [unifiedAssetId]
    );

    if (assetResult.rows.length === 0) {
      return null;
    }

    const unifiedAsset = assetResult.rows[0];

    // Get all mappings with asset details
    const mappingsResult = await query<any>(
      `SELECT
        am.*,
        a.symbol as asset_symbol,
        a.platform as asset_platform
       FROM asset_mappings am
       JOIN assets a ON am.asset_id = a.id
       WHERE am.unified_asset_id = $1
       ORDER BY am.confidence_score DESC, a.platform, a.symbol`,
      [unifiedAssetId]
    );

    return {
      ...unifiedAsset,
      mappings: mappingsResult.rows,
    };
  }

  /**
   * Get all unified assets with their mappings
   */
  async findAllWithMappings(): Promise<UnifiedAssetWithMappings[]> {
    const unifiedAssets = await this.findAll();

    const result: UnifiedAssetWithMappings[] = [];

    for (const asset of unifiedAssets) {
      const withMappings = await this.findWithMappings(asset.id);
      if (withMappings) {
        result.push(withMappings);
      }
    }

    return result;
  }

  /**
   * Create a new unified asset
   */
  async create(params: CreateUnifiedAssetParams): Promise<UnifiedAsset> {
    const { normalized_symbol, display_name, description, coingecko_id, coingecko_name, coingecko_symbol } = params;

    const result = await query<UnifiedAsset>(
      `INSERT INTO unified_assets (normalized_symbol, display_name, description, coingecko_id, coingecko_name, coingecko_symbol)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (normalized_symbol) DO UPDATE
       SET display_name = COALESCE(EXCLUDED.display_name, unified_assets.display_name),
           description = COALESCE(EXCLUDED.description, unified_assets.description),
           coingecko_id = COALESCE(EXCLUDED.coingecko_id, unified_assets.coingecko_id),
           coingecko_name = COALESCE(EXCLUDED.coingecko_name, unified_assets.coingecko_name),
           coingecko_symbol = COALESCE(EXCLUDED.coingecko_symbol, unified_assets.coingecko_symbol),
           updated_at = NOW()
       RETURNING *`,
      [normalized_symbol, display_name || null, description || null, coingecko_id || null, coingecko_name || null, coingecko_symbol || null]
    );

    logger.info(`Unified asset created/updated: ${normalized_symbol}`);
    return result.rows[0];
  }

  /**
   * Update a unified asset
   */
  async update(id: number, params: Partial<CreateUnifiedAssetParams>): Promise<UnifiedAsset | null> {
    const { normalized_symbol, display_name, description } = params;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (normalized_symbol !== undefined) {
      updates.push(`normalized_symbol = $${paramIndex++}`);
      values.push(normalized_symbol);
    }

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return this.findByNormalizedSymbol(normalized_symbol || '');
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query<UnifiedAsset>(
      `UPDATE unified_assets SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  /**
   * Delete a unified asset
   */
  async delete(id: number): Promise<boolean> {
    const result = await query(
      'DELETE FROM unified_assets WHERE id = $1',
      [id]
    );

    return (result.rowCount || 0) > 0;
  }

  /**
   * Count unified assets
   */
  async count(): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM unified_assets'
    );

    return parseInt(result.rows[0].count);
  }

  /**
   * Get unified assets available on at least minPlatforms platforms
   */
  async findMultiPlatformAssets(
    minPlatforms: number = 3
  ): Promise<Array<UnifiedAsset & {
    platform_count: number;
    platforms: string[];
    avg_confidence: number;
    avg_correlation: number | null;
  }>> {
    const result = await query<any>(
      `SELECT
        ua.id,
        ua.normalized_symbol,
        ua.display_name,
        ua.description,
        ua.coingecko_id,
        ua.coingecko_name,
        ua.coingecko_symbol,
        ua.created_at,
        ua.updated_at,
        COUNT(DISTINCT a.platform)::integer as platform_count,
        ARRAY_AGG(DISTINCT a.platform ORDER BY a.platform) as platforms,
        ROUND(AVG(am.confidence_score))::integer as avg_confidence,
        AVG(CAST(am.price_correlation AS DECIMAL)) as avg_correlation
      FROM unified_assets ua
      JOIN asset_mappings am ON ua.id = am.unified_asset_id
      JOIN assets a ON am.asset_id = a.id
      WHERE a.is_active = true
      GROUP BY ua.id, ua.normalized_symbol, ua.display_name, ua.description,
               ua.coingecko_id, ua.coingecko_name, ua.coingecko_symbol,
               ua.created_at, ua.updated_at
      HAVING COUNT(DISTINCT a.platform) >= $1
      ORDER BY platform_count DESC, ua.normalized_symbol ASC`,
      [minPlatforms]
    );

    return result.rows;
  }
}

export default new UnifiedAssetRepository();
