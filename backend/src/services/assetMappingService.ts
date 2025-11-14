import AssetRepository from '../models/AssetRepository';
import UnifiedAssetRepository from '../models/UnifiedAssetRepository';
import AssetMappingRepository from '../models/AssetMappingRepository';
import {
  normalizeSymbol,
  groupAssetsByNormalizedSymbol,
  isSameAsset,
} from '../utils/symbolNormalization';
import { logger } from '../utils/logger';

export class AssetMappingService {
  /**
   * Generate asset mappings across all platforms using symbol normalization
   * @param priceValidation - If true, compare prices to validate matches (not implemented yet)
   * @returns Number of mappings created
   */
  async generateMappings(priceValidation: boolean = false): Promise<{
    unifiedAssetsCreated: number;
    mappingsCreated: number;
  }> {
    logger.info('Starting asset mapping generation');

    // Get all active assets from all platforms
    const allAssets = await AssetRepository.findAllActive();
    logger.info(`Found ${allAssets.length} active assets across all platforms`);

    // Group assets by normalized symbol
    const groupedAssets = groupAssetsByNormalizedSymbol(allAssets);
    logger.info(`Grouped into ${groupedAssets.size} normalized symbols`);

    let unifiedAssetsCreated = 0;
    let mappingsCreated = 0;

    // For each normalized symbol group
    for (const [normalizedSymbol, assets] of groupedAssets.entries()) {
      try {
        // Skip if only one asset (no cross-platform mapping needed)
        if (assets.length === 1) {
          logger.debug(`Skipping ${normalizedSymbol}: only one asset`);
          continue;
        }

        logger.info(
          `Processing ${normalizedSymbol}: ${assets.length} assets across platforms: ${assets
            .map((a) => a.platform)
            .join(', ')}`
        );

        // Create or get unified asset
        let unifiedAsset = await UnifiedAssetRepository.findByNormalizedSymbol(
          normalizedSymbol
        );

        if (!unifiedAsset) {
          unifiedAsset = await UnifiedAssetRepository.create({
            normalized_symbol: normalizedSymbol,
            display_name: this.generateDisplayName(normalizedSymbol),
            description: `Perpetual futures contract for ${normalizedSymbol}`,
          });
          unifiedAssetsCreated++;
          logger.info(`Created unified asset: ${normalizedSymbol}`);
        }

        // Create mappings for each asset in this group
        for (const asset of assets) {
          // Check if mapping already exists
          const existingMapping = await AssetMappingRepository.findByUnifiedAndAsset(
            unifiedAsset.id,
            asset.id
          );

          if (!existingMapping) {
            // Calculate confidence score
            const confidenceScore = this.calculateConfidenceScore(
              asset.symbol,
              normalizedSymbol,
              asset.platform
            );

            await AssetMappingRepository.create({
              unified_asset_id: unifiedAsset.id,
              asset_id: asset.id,
              confidence_score: confidenceScore,
              mapping_method: 'auto_symbol',
              price_used: null, // Price validation not implemented yet
            });

            mappingsCreated++;
            logger.debug(
              `Created mapping: ${asset.platform}:${asset.symbol} → ${normalizedSymbol} (confidence: ${confidenceScore})`
            );
          }
        }
      } catch (error) {
        logger.error(
          `Failed to create mappings for ${normalizedSymbol}: ${error}`
        );
      }
    }

    logger.info(
      `Asset mapping generation complete: ${unifiedAssetsCreated} unified assets created, ${mappingsCreated} mappings created`
    );

    return {
      unifiedAssetsCreated,
      mappingsCreated,
    };
  }

  /**
   * Calculate confidence score for a mapping
   * @param originalSymbol - The platform-specific symbol
   * @param normalizedSymbol - The normalized symbol
   * @param platform - The platform name
   * @returns Confidence score (0-100)
   */
  private calculateConfidenceScore(
    originalSymbol: string,
    normalizedSymbol: string,
    platform: string
  ): number {
    let score = 100;

    // Exact match = 100
    if (originalSymbol.toUpperCase() === normalizedSymbol) {
      return 100;
    }

    // Simple suffix removal (e.g., BTCUSDT → BTC) = 95
    if (originalSymbol.toUpperCase().startsWith(normalizedSymbol)) {
      return 95;
    }

    // Complex transformations = 90
    return 90;
  }

  /**
   * Generate a human-readable display name for a normalized symbol
   * @param normalizedSymbol - The normalized symbol (e.g., "BTC")
   * @returns Display name (e.g., "Bitcoin")
   */
  private generateDisplayName(normalizedSymbol: string): string {
    // Common cryptocurrency names
    const names: Record<string, string> = {
      BTC: 'Bitcoin',
      ETH: 'Ethereum',
      SOL: 'Solana',
      AVAX: 'Avalanche',
      MATIC: 'Polygon',
      BNB: 'Binance Coin',
      ADA: 'Cardano',
      DOT: 'Polkadot',
      LINK: 'Chainlink',
      UNI: 'Uniswap',
      ATOM: 'Cosmos',
      XRP: 'Ripple',
      DOGE: 'Dogecoin',
      LTC: 'Litecoin',
      BCH: 'Bitcoin Cash',
      // Add more as needed
    };

    return names[normalizedSymbol] || normalizedSymbol;
  }

  /**
   * Manually create a mapping between an asset and a unified asset
   */
  async createManualMapping(
    assetId: number,
    normalizedSymbol: string
  ): Promise<boolean> {
    try {
      // Get or create unified asset
      let unifiedAsset = await UnifiedAssetRepository.findByNormalizedSymbol(
        normalizedSymbol
      );

      if (!unifiedAsset) {
        unifiedAsset = await UnifiedAssetRepository.create({
          normalized_symbol: normalizedSymbol,
          display_name: this.generateDisplayName(normalizedSymbol),
        });
      }

      // Create mapping
      await AssetMappingRepository.create({
        unified_asset_id: unifiedAsset.id,
        asset_id: assetId,
        confidence_score: 100,
        mapping_method: 'manual',
      });

      logger.info(
        `Manual mapping created: asset_id=${assetId} → ${normalizedSymbol}`
      );
      return true;
    } catch (error) {
      logger.error(`Failed to create manual mapping: ${error}`);
      return false;
    }
  }

  /**
   * Remove a mapping
   */
  async removeMapping(mappingId: number): Promise<boolean> {
    try {
      const result = await AssetMappingRepository.delete(mappingId);
      logger.info(`Mapping removed: id=${mappingId}`);
      return result;
    } catch (error) {
      logger.error(`Failed to remove mapping: ${error}`);
      return false;
    }
  }
}

export default new AssetMappingService();
