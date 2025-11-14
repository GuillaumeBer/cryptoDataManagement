import { query } from '../database/connection';
import { AssetMapping, CreateAssetMappingParams } from './types';
import { logger } from '../utils/logger';

export class AssetMappingRepository {
  /**
   * Find mapping by unified asset ID and asset ID
   */
  async findByUnifiedAndAsset(
    unifiedAssetId: number,
    assetId: number
  ): Promise<AssetMapping | null> {
    const result = await query<AssetMapping>(
      'SELECT * FROM asset_mappings WHERE unified_asset_id = $1 AND asset_id = $2',
      [unifiedAssetId, assetId]
    );

    return result.rows[0] || null;
  }

  /**
   * Find all mappings for a unified asset
   */
  async findByUnifiedAsset(unifiedAssetId: number): Promise<AssetMapping[]> {
    const result = await query<AssetMapping>(
      'SELECT * FROM asset_mappings WHERE unified_asset_id = $1 ORDER BY confidence_score DESC',
      [unifiedAssetId]
    );

    return result.rows;
  }

  /**
   * Find mapping for a platform-specific asset
   */
  async findByAsset(assetId: number): Promise<AssetMapping | null> {
    const result = await query<AssetMapping>(
      'SELECT * FROM asset_mappings WHERE asset_id = $1',
      [assetId]
    );

    return result.rows[0] || null;
  }

  /**
   * Create a new asset mapping
   */
  async create(params: CreateAssetMappingParams): Promise<AssetMapping> {
    const { unified_asset_id, asset_id, confidence_score, mapping_method, price_used } = params;

    const result = await query<AssetMapping>(
      `INSERT INTO asset_mappings (
        unified_asset_id,
        asset_id,
        confidence_score,
        mapping_method,
        price_used
      )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (unified_asset_id, asset_id) DO UPDATE
       SET confidence_score = EXCLUDED.confidence_score,
           mapping_method = EXCLUDED.mapping_method,
           price_used = EXCLUDED.price_used,
           updated_at = NOW()
       RETURNING *`,
      [
        unified_asset_id,
        asset_id,
        confidence_score || 100,
        mapping_method,
        price_used || null,
      ]
    );

    logger.info(
      `Asset mapping created/updated: unified_asset_id=${unified_asset_id}, asset_id=${asset_id}, method=${mapping_method}`
    );
    return result.rows[0];
  }

  /**
   * Bulk create asset mappings
   */
  async bulkCreate(mappings: CreateAssetMappingParams[]): Promise<number> {
    if (mappings.length === 0) return 0;

    const values = mappings
      .map(
        (m, idx) =>
          `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
      )
      .join(', ');

    const params = mappings.flatMap((m) => [
      m.unified_asset_id,
      m.asset_id,
      m.confidence_score || 100,
      m.mapping_method,
      m.price_used || null,
    ]);

    const result = await query(
      `INSERT INTO asset_mappings (
        unified_asset_id,
        asset_id,
        confidence_score,
        mapping_method,
        price_used
      )
       VALUES ${values}
       ON CONFLICT (unified_asset_id, asset_id) DO UPDATE
       SET confidence_score = EXCLUDED.confidence_score,
           mapping_method = EXCLUDED.mapping_method,
           price_used = EXCLUDED.price_used,
           updated_at = NOW()`,
      params
    );

    logger.info(`Bulk created/updated ${mappings.length} asset mappings`);
    return result.rowCount || 0;
  }

  /**
   * Update a mapping
   */
  async update(
    id: number,
    params: Partial<Omit<CreateAssetMappingParams, 'unified_asset_id' | 'asset_id'>>
  ): Promise<AssetMapping | null> {
    const { confidence_score, mapping_method, price_used } = params;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (confidence_score !== undefined) {
      updates.push(`confidence_score = $${paramIndex++}`);
      values.push(confidence_score);
    }

    if (mapping_method !== undefined) {
      updates.push(`mapping_method = $${paramIndex++}`);
      values.push(mapping_method);
    }

    if (price_used !== undefined) {
      updates.push(`price_used = $${paramIndex++}`);
      values.push(price_used);
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query<AssetMapping>(
      `UPDATE asset_mappings SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  /**
   * Delete a mapping
   */
  async delete(id: number): Promise<boolean> {
    const result = await query('DELETE FROM asset_mappings WHERE id = $1', [id]);

    return (result.rowCount || 0) > 0;
  }

  /**
   * Delete all mappings for a unified asset
   */
  async deleteByUnifiedAsset(unifiedAssetId: number): Promise<number> {
    const result = await query(
      'DELETE FROM asset_mappings WHERE unified_asset_id = $1',
      [unifiedAssetId]
    );

    return result.rowCount || 0;
  }

  /**
   * Count total mappings
   */
  async count(): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM asset_mappings'
    );

    return parseInt(result.rows[0].count);
  }
}

export default new AssetMappingRepository();
