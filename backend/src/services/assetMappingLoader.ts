import * as fs from 'fs';
import * as path from 'path';
import { UnifiedAssetRepository } from '../models/UnifiedAssetRepository';
import { AssetMappingRepository } from '../models/AssetMappingRepository';
import { logger } from '../utils/logger';

interface MappingFileFormat {
  version: string;
  generated_at: string;
  total_unified_assets: number;
  platforms: string[];
  mappings: Array<{
    unified_asset_id: number;
    normalized_symbol: string;
    display_name: string | null;
    coingecko_id: string | null;
    coingecko_name: string | null;
    coingecko_symbol: string | null;
    platform_count: number;
    platforms: Array<{
      platform: string;
      symbol: string;
      asset_id: number;
      confidence: number;
      correlation: number | null;
      method: 'auto_symbol' | 'auto_price' | 'manual';
      last_validated: string | null;
    }>;
  }>;
}

export class AssetMappingLoader {
  private unifiedAssetRepo: UnifiedAssetRepository;
  private mappingRepo: AssetMappingRepository;

  constructor() {
    this.unifiedAssetRepo = new UnifiedAssetRepository();
    this.mappingRepo = new AssetMappingRepository();
  }

  /**
   * Load asset mappings from JSON file
   */
  async loadFromFile(filePath: string): Promise<void> {
    logger.info(`Loading asset mappings from ${filePath}...`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      logger.warn(`Mapping file not found at ${filePath}`);
      logger.info('Mappings will need to be generated using buildAssetMappings script');
      return;
    }

    try {
      // Read and parse file
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const mappingData: MappingFileFormat = JSON.parse(fileContent);

      // Validate version
      if (!this.isCompatibleVersion(mappingData.version)) {
        throw new Error(
          `Incompatible mapping file version: ${mappingData.version}. Expected 1.x.x`
        );
      }

      logger.info(`Mapping file version: ${mappingData.version}`);
      logger.info(`Generated at: ${mappingData.generated_at}`);
      logger.info(`Total unified assets: ${mappingData.total_unified_assets}`);

      // Load each unified asset and its mappings
      let loadedAssets = 0;
      let loadedMappings = 0;

      for (const mapping of mappingData.mappings) {
        try {
          // Create or update unified asset
          const unifiedAsset = await this.unifiedAssetRepo.create({
            normalized_symbol: mapping.normalized_symbol,
            display_name: mapping.display_name || undefined,
            coingecko_id: mapping.coingecko_id || undefined,
            coingecko_name: mapping.coingecko_name || undefined,
            coingecko_symbol: mapping.coingecko_symbol || undefined,
          });

          loadedAssets++;

          // Create or update platform mappings
          for (const platformMapping of mapping.platforms) {
            await this.mappingRepo.create({
              unified_asset_id: unifiedAsset.id,
              asset_id: platformMapping.asset_id,
              confidence_score: platformMapping.confidence,
              mapping_method: platformMapping.method,
              price_correlation: platformMapping.correlation || undefined,
              last_validated_at: platformMapping.last_validated
                ? new Date(platformMapping.last_validated)
                : undefined,
            });

            loadedMappings++;
          }
        } catch (error) {
          logger.error(
            `Error loading mapping for ${mapping.normalized_symbol}:`,
            error
          );
          // Continue with next mapping
        }
      }

      logger.info(`Successfully loaded ${loadedAssets} unified assets`);
      logger.info(`Successfully loaded ${loadedMappings} platform mappings`);
    } catch (error) {
      logger.error('Error loading mapping file:', error);
      throw error;
    }
  }

  /**
   * Check if mapping file version is compatible
   */
  private isCompatibleVersion(version: string): boolean {
    const [major] = version.split('.');
    return major === '1';
  }

  /**
   * Get mapping file statistics
   */
  async getFileStats(filePath: string): Promise<{
    exists: boolean;
    version?: string;
    generatedAt?: Date;
    totalAssets?: number;
    platforms?: string[];
  }> {
    if (!fs.existsSync(filePath)) {
      return { exists: false };
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const mappingData: MappingFileFormat = JSON.parse(fileContent);

      return {
        exists: true,
        version: mappingData.version,
        generatedAt: new Date(mappingData.generated_at),
        totalAssets: mappingData.total_unified_assets,
        platforms: mappingData.platforms,
      };
    } catch (error) {
      logger.error('Error reading mapping file stats:', error);
      return { exists: true };
    }
  }
}

export default new AssetMappingLoader();
