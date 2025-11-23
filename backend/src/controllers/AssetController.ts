import { Request, Response } from 'express';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import UnifiedAssetRepository from '../models/UnifiedAssetRepository';
import assetMappingService from '../services/assetMappingService';
import { logger } from '../utils/logger';

export class AssetController {
  /**
   * GET /api/assets
   * List all available assets
   */
  static async getAssets(req: Request, res: Response) {
    try {
      const { platform } = req.query;

      const assets = platform
        ? await AssetRepository.findByPlatform(platform as string)
        : await AssetRepository.findAllActive();

      // Get staleness info for assets (only if platform is specified)
      let stalenessMap: Map<number, number> | null = null;
      if (platform) {
        stalenessMap = await FundingRateRepository.getAssetStaleness(platform as string);
      }

      // Add staleness info to each asset
      const assetsWithStaleness = assets.map(asset => ({
        ...asset,
        daysStale: stalenessMap ? (stalenessMap.get(asset.id) || 999) : undefined,
      }));

      res.json({
        success: true,
        data: assetsWithStaleness,
        count: assets.length,
      });
    } catch (error) {
      logger.error('Assets endpoint error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assets',
        error: `${error}`,
      });
    }
  }

  /**
   * GET /api/unified-assets
   * Get all unified assets with their platform mappings
   */
  static async getUnifiedAssets(_req: Request, res: Response) {
    try {
      const unifiedAssets = await UnifiedAssetRepository.findAllWithMappings();

      return res.json({
        success: true,
        data: unifiedAssets,
        count: unifiedAssets.length,
      });
    } catch (error) {
      logger.error('Unified assets endpoint error', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch unified assets',
        error: `${error}`,
      });
    }
  }

  /**
   * GET /api/unified-assets/multi-platform?minPlatforms=3
   * Get unified assets available on at least N platforms
   */
  static async getMultiPlatformAssets(req: Request, res: Response) {
    try {
      const minPlatforms = parseInt(req.query.minPlatforms as string) || 3;

      if (minPlatforms < 1 || minPlatforms > 10) {
        return res.status(400).json({
          success: false,
          message: 'minPlatforms must be between 1 and 10',
        });
      }

      const multiPlatformAssets = await UnifiedAssetRepository.findMultiPlatformAssets(
        minPlatforms
      );

      return res.json({
        success: true,
        data: multiPlatformAssets,
        count: multiPlatformAssets.length,
        minPlatforms,
      });
    } catch (error) {
      logger.error('Multi-platform assets endpoint error', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch multi-platform assets',
        error: `${error}`,
      });
    }
  }

  /**
   * GET /api/unified-assets/:id
   * Get a specific unified asset with its mappings
   */
  static async getUnifiedAssetById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const unifiedAsset = await UnifiedAssetRepository.findWithMappings(parseInt(id));

      if (!unifiedAsset) {
        return res.status(404).json({
          success: false,
          message: `Unified asset ${id} not found`,
        });
      }

      return res.json({
        success: true,
        data: unifiedAsset,
      });
    } catch (error) {
      logger.error('Unified asset endpoint error', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch unified asset',
        error: `${error}`,
      });
    }
  }

  /**
   * POST /api/unified-assets/generate-mappings
   * Generate asset mappings across all platforms
   */
  static async generateMappings(_req: Request, res: Response) {
    try {
      logger.info('Generating asset mappings');

      const result = await assetMappingService.generateMappings();

      return res.json({
        success: true,
        message: 'Asset mappings generated',
        data: result,
      });
    } catch (error) {
      logger.error('Generate mappings endpoint error', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate mappings',
        error: `${error}`,
      });
    }
  }

  /**
   * POST /api/unified-assets/manual-mapping
   * Manually create a mapping between an asset and a unified asset
   */
  static async createManualMapping(req: Request, res: Response) {
    try {
      const { assetId, normalizedSymbol } = req.body;

      if (!assetId || !normalizedSymbol) {
        return res.status(400).json({
          success: false,
          message: 'assetId and normalizedSymbol are required',
        });
      }

      const result = await assetMappingService.createManualMapping(assetId, normalizedSymbol);

      return res.json({
        success: result,
        message: result ? 'Manual mapping created' : 'Failed to create manual mapping',
      });
    } catch (error) {
      logger.error('Manual mapping endpoint error', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create manual mapping',
        error: `${error}`,
      });
    }
  }

  /**
   * GET /api/analytics/:asset
   * Get analytics for specific asset
   */
  static async getAssetAnalytics(req: Request, res: Response) {
    try {
      const { asset } = req.params;
      const { platform = 'hyperliquid' } = req.query;

      const analytics = await FundingRateRepository.getAssetAnalytics(
        asset,
        platform as string
      );

      if (!analytics) {
        return res.status(404).json({
          success: false,
          message: `Asset ${asset} not found`,
        });
      }

      return res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error('Analytics endpoint error', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch analytics',
        error: `${error}`,
      });
    }
  }
}
