#!/usr/bin/env node
import 'dotenv/config';
import { AssetRepository } from '../models/AssetRepository';
import { UnifiedAssetRepository } from '../models/UnifiedAssetRepository';
import { AssetMappingRepository } from '../models/AssetMappingRepository';
import { CoinGeckoClient } from '../api/coingecko/client';
import { AssetCorrelationService } from '../services/assetCorrelationService';
import OHLCVRepository from '../models/OHLCVRepository';
import { logger } from '../utils/logger';
import { normalizeSymbol } from '../utils/symbolNormalization';
import * as fs from 'fs';
import * as path from 'path';

interface AssetGroup {
  normalizedSymbol: string;
  assets: Array<{ id: number; symbol: string; platform: string }>;
}

export class AssetMappingBuilder {
  private assetRepo: AssetRepository;
  private unifiedAssetRepo: UnifiedAssetRepository;
  private assetMappingRepo: AssetMappingRepository;
  private coingeckoClient: CoinGeckoClient;
  private correlationService: AssetCorrelationService;

  constructor() {
    this.assetRepo = new AssetRepository();
    this.unifiedAssetRepo = new UnifiedAssetRepository();
    this.assetMappingRepo = new AssetMappingRepository();
    this.coingeckoClient = new CoinGeckoClient();
    this.correlationService = new AssetCorrelationService(
      OHLCVRepository,
      this.assetRepo
    );
  }

  /**
   * Group assets by normalized symbol
   */
  private groupAssetsByNormalizedSymbol(
    assets: Array<{ id: number; symbol: string; platform: string }>
  ): AssetGroup[] {
    const groups = new Map<string, AssetGroup>();

    for (const asset of assets) {
      const normalized = normalizeSymbol(asset.symbol, asset.platform);
      if (!groups.has(normalized)) {
        groups.set(normalized, {
          normalizedSymbol: normalized,
          assets: [],
        });
      }
      groups.get(normalized)!.assets.push(asset);
    }

    return Array.from(groups.values());
  }

  /**
   * Main mapping builder
   */
  async buildMappings(
    minPlatforms: number = 1,
    validateWithPrice: boolean = true
  ) {
    logger.info('========================================');
    logger.info('Starting Asset Mapping Builder');
    logger.info('========================================');

    // Step 1: Fetch all active assets
    logger.info('Step 1: Fetching all active assets from database...');
    const allAssets = await this.assetRepo.findAllActive();
    logger.info(`Found ${allAssets.length} active assets across all platforms`);

    // Step 2: Group by normalized symbol
    logger.info('Step 2: Grouping assets by normalized symbol...');
    const groups = this.groupAssetsByNormalizedSymbol(allAssets);
    logger.info(`Grouped into ${groups.length} unique normalized symbols`);

    // Filter by minimum platforms
    const multiPlatformGroups = groups.filter(
      (g) => new Set(g.assets.map((a) => a.platform)).size >= minPlatforms
    );
    logger.info(
      `${multiPlatformGroups.length} assets available on ${minPlatforms}+ platforms`
    );

    let processed = 0;
    let unifiedAssetsCreated = 0;
    let mappingsCreated = 0;

    // Step 3: Process each group
    for (const group of multiPlatformGroups) {
      logger.info('----------------------------------------');
      const platformList = [
        ...new Set(group.assets.map((a) => a.platform)),
      ].join(', ');
      logger.info(
        `Processing: ${group.normalizedSymbol} (${
          new Set(group.assets.map((a) => a.platform)).size
        } platforms: ${platformList})`
      );

      try {
        // Find CoinGecko match
        const coingeckoCoin = await this.coingeckoClient.findCoinBySymbol(
          group.normalizedSymbol
        );

        if (!coingeckoCoin) {
          logger.warn(
            `No CoinGecko match found for ${group.normalizedSymbol}, skipping...`
          );
          continue;
        }

        logger.info(
          `Matched to CoinGecko: ${coingeckoCoin.name} (${coingeckoCoin.id})`
        );

        // Fetch market cap from CoinGecko
        let marketCap: number | null = null;
        try {
          const marketData = await this.coingeckoClient.getMarketData(250, 1);
          const coinMarketData = marketData.find(m => m.id === coingeckoCoin.id);
          if (coinMarketData) {
            marketCap = coinMarketData.market_cap;
            logger.info(`Market cap for ${coingeckoCoin.name}: $${marketCap.toLocaleString()}`);
          }
        } catch (error) {
          logger.warn(`Could not fetch market cap for ${coingeckoCoin.name}:`, error);
        }

        // Price validation if requested and multiple assets
        let validatedAssets = group.assets;
        let avgCorrelation: number | null = null;

        if (validateWithPrice && group.assets.length > 1) {
          logger.info('Validating with price correlation...');
          try {
            const correlationResult = await this.correlationService.validateAssetGroup(
              group.assets.map((a) => a.id)
            );

            if (correlationResult.validatedAssetIds.length > 0) {
              validatedAssets = group.assets.filter((a) =>
                correlationResult.validatedAssetIds.includes(a.id)
              );
              avgCorrelation = correlationResult.avgCorrelation;
              logger.info(
                `Price validation: ${validatedAssets.length}/${group.assets.length} assets in main cluster (avg correlation: ${avgCorrelation.toFixed(4)})`
              );

              if (validatedAssets.length < group.assets.length) {
                const outliers = group.assets.filter(
                  (a) =>
                    !correlationResult.validatedAssetIds.includes(a.id)
                );
                logger.warn(
                  `Outliers (low correlation): ${outliers
                    .map((a) => `${a.platform}:${a.symbol}`)
                    .join(', ')}`
                );
              }
            } else {
              logger.warn('Price validation failed, using symbol matching');
            }
          } catch (error) {
            logger.error(`Price validation error: ${error}`);
            logger.info('Continuing with symbol-based matching');
          }
        }

        // Create or update unified asset
        let unifiedAsset = await this.unifiedAssetRepo.findByNormalizedSymbol(
          group.normalizedSymbol
        );

        if (!unifiedAsset) {
          unifiedAsset = await this.unifiedAssetRepo.create({
            normalized_symbol: group.normalizedSymbol,
            display_name: coingeckoCoin.name,
            description: `${coingeckoCoin.name} perpetual contracts across multiple platforms`,
            coingecko_id: coingeckoCoin.id,
            coingecko_name: coingeckoCoin.name,
            coingecko_symbol: coingeckoCoin.symbol,
            market_cap_usd: marketCap,
          });
          unifiedAssetsCreated++;
        } else {
          // Update with CoinGecko data if not already set
          await this.unifiedAssetRepo.update(unifiedAsset.id, {
            display_name: coingeckoCoin.name,
            coingecko_id: coingeckoCoin.id,
            coingecko_name: coingeckoCoin.name,
            coingecko_symbol: coingeckoCoin.symbol,
            market_cap_usd: marketCap,
          });
        }

        logger.info(
          `${
            unifiedAsset ? 'Updated' : 'Created'
          } unified asset: ${group.normalizedSymbol} (ID: ${unifiedAsset.id})`
        );

        // Create mappings for validated assets
        for (const asset of validatedAssets) {
          const confidence =
            avgCorrelation !== null
              ? this.correlationToConfidence(avgCorrelation)
              : 85;
          const method =
            avgCorrelation !== null ? 'auto_price' : 'auto_symbol';

          await this.assetMappingRepo.create({
            unified_asset_id: unifiedAsset.id,
            asset_id: asset.id,
            confidence_score: confidence,
            mapping_method: method,
            price_correlation: avgCorrelation,
            last_validated_at:
              avgCorrelation !== null ? new Date() : undefined,
          });

          mappingsCreated++;
          logger.info(
            `Created mapping: ${asset.platform}:${asset.symbol} -> ${
              group.normalizedSymbol
            } (confidence: ${confidence}%${
              avgCorrelation !== null
                ? `, correlation: ${avgCorrelation.toFixed(4)}`
                : ''
            })`
          );
        }

        processed++;
      } catch (error) {
        logger.error(`Error processing ${group.normalizedSymbol}`, { error });
      }
    }

    logger.info('========================================');
    logger.info(
      `Completed! Processed: ${processed}, Unified assets: ${unifiedAssetsCreated}, Mappings: ${mappingsCreated}`
    );
    logger.info('========================================');

    // Export to JSON
    await this.exportToJSON();
  }

  /**
   * Convert correlation coefficient to confidence score
   */
  private correlationToConfidence(correlation: number): number {
    if (correlation >= 0.98) return 100;
    if (correlation >= 0.95) return 98;
    if (correlation >= 0.90) return 95;
    if (correlation >= 0.85) return 90;
    return 85;
  }

  /**
   * Export mappings to JSON file
   */
  private async exportToJSON() {
    const multiPlatformAssets = await this.unifiedAssetRepo.findMultiPlatformAssets(
      2
    );

    const output = {
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      total_unified_assets: multiPlatformAssets.length,
      platforms: [
        'hyperliquid',
        'binance',
        'bybit',
        'okx',
        'dydx',
        'aster',
      ],
      mappings: multiPlatformAssets.map((ua: any) => ({
        unified_asset_id: ua.id,
        normalized_symbol: ua.normalized_symbol,
        display_name: ua.display_name,
        coingecko_id: ua.coingecko_id,
        coingecko_name: ua.coingecko_name,
        coingecko_symbol: ua.coingecko_symbol,
        market_cap_usd: ua.market_cap_usd ? parseInt(ua.market_cap_usd) : null,
        platform_count: ua.platform_count,
        platforms: ua.platforms,
        avg_confidence: ua.avg_confidence,
        avg_correlation: ua.avg_correlation
          ? parseFloat(ua.avg_correlation)
          : null,
      })),
    };

    const outputPath = path.join(
      __dirname,
      '../../data/asset-mappings.json'
    );
    const dir = path.dirname(outputPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    logger.info(`Exported mappings to: ${outputPath}`);
  }
}

// Run if executed directly
if (require.main === module) {
  const builder = new AssetMappingBuilder();
  builder
    .buildMappings(2, true) // Min 2 platforms, with price validation
    .then(() => {
      logger.info('Asset mapping complete!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Asset mapping failed', { error });
      process.exit(1);
    });
}
