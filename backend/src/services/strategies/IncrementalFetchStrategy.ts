import { FetchStrategy, FetchResult } from './FetchStrategy';
import { FetchStage } from '../fetchTypes';
import { FundingPipeline } from '../pipelines/FundingPipeline';
import { OHLCVPipeline } from '../pipelines/OHLCVPipeline';
import { OpenInterestPipeline } from '../pipelines/OpenInterestPipeline';
import { LongShortRatioPipeline } from '../pipelines/LongShortRatioPipeline';
import { LiquidationPipeline } from '../pipelines/LiquidationPipeline';
import AssetRepository from '../../models/AssetRepository';
import { normalizePlatformAsset } from '../normalizers/platformAssetNormalizer';
import { logger } from '../../utils/logger';

/**
 * Incremental fetch strategy - fetches recent updates only
 * Uses existing assets from database, no asset discovery
 */
export class IncrementalFetchStrategy extends FetchStrategy {
  protected getStageOrder(): FetchStage[] {
    // No asset discovery for incremental
    const stages: FetchStage[] = [
      'fundingFetch',
      'fundingStore',
      'ohlcvFetch',
      'ohlcvStore',
    ];

    if (this.platform !== 'hyperliquid' && this.platform !== 'aster') {
      stages.push('oiFetch', 'oiStore');
    }

    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster') {
      stages.push(
        'lsRatioFetch',
        'lsRatioStore'
      );
    }

    // Liquidation stages removed for OKX (deprecated API)
    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster' && this.platform !== 'binance' && this.platform !== 'bybit' && this.platform !== 'okx') {
      stages.push(
        'liquidationFetch',
        'liquidationStore'
      );
    }

    return stages;
  }

  protected estimateStageTotals(assetCount: number): Partial<Record<FetchStage, number>> {
    const totals: Partial<Record<FetchStage, number>> = {
      fundingFetch: assetCount,
      fundingStore: assetCount,
      ohlcvFetch: assetCount,
      ohlcvStore: assetCount,
    };

    if (this.platform !== 'hyperliquid' && this.platform !== 'aster') {
      totals.oiFetch = assetCount;
      totals.oiStore = assetCount;
    }

    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster') {
      totals.lsRatioFetch = assetCount;
      totals.lsRatioStore = assetCount;
    }

    // Liquidation totals removed for OKX (deprecated API)
    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster' && this.platform !== 'binance' && this.platform !== 'bybit' && this.platform !== 'okx') {
      totals.liquidationFetch = assetCount;
      totals.liquidationStore = assetCount;
    }

    return totals;
  }

  protected async getAssets(): Promise<string[]> {
    // If platform is dydx, use its own market list to ensure we only fetch valid markets
    if (this.platform === 'dydx') {
      const dydxMarkets = await this.platformClient.getAssets(); // returns DyDxAsset[]
      
      // Normalize and upsert to ensure they exist in DB for pipelines
      const normalizedAssets = dydxMarkets
        .map(asset => normalizePlatformAsset(this.platform, asset))
        .filter((a): a is NonNullable<typeof a> => a !== null);
      
      await AssetRepository.bulkUpsert(normalizedAssets);
      
      const symbols = normalizedAssets.map(a => a.symbol);
      logger.info(`Found ${symbols.length} active dydx markets for incremental fetch`);
      return symbols;
    }

    // Get existing assets from database (no discovery)
    const existingAssets = await AssetRepository.findByPlatform(this.platform);
    logger.info(`Found ${existingAssets.length} existing assets for ${this.platform}`);
    return existingAssets.map(a => a.symbol);
  }

  async execute(): Promise<FetchResult> {
    logger.info(`Starting incremental fetch for ${this.platform}`);

    // Get existing assets (no discovery)
    const assets = await this.getAssets();
    const assetCount = assets.length;

    if (assetCount === 0) {
      logger.warn(`No assets found for ${this.platform}. Run initial fetch first.`);
      return {
        assetsProcessed: 0,
        recordsFetched: 0,
        ohlcvRecordsFetched: 0,
        oiRecordsFetched: 0,
        lsRatioRecordsFetched: 0,
        liquidationRecordsFetched: 0,
        errors: ['No assets found. Run initial fetch first.'],
      };
    }

    // Initialize progress tracking
    const stageOrder = this.getStageOrder();
    const stageTotals = this.estimateStageTotals(assetCount);
    this.progressTracker.initialize(stageOrder, stageTotals, assetCount);
    this.progressTracker.setPhase('fetch');

    // Emit start event
    this.progressTracker.emitProgress('start', 'fundingFetch', `Starting incremental fetch for ${assetCount} assets`);

    // Create pipelines
    const fundingPipeline = new FundingPipeline(
      this.config,
      this.progressTracker,
      this.rateLimiter,
      this.platformClient,
      this.platform
    );

    const ohlcvPipeline = new OHLCVPipeline(
      this.config,
      this.progressTracker,
      this.rateLimiter,
      this.platformClient,
      this.platform
    );

    // Execute pipelines sequentially to avoid rate limits/WAF blocks
    const fundingRecords = await fundingPipeline.execute(assets);
    const ohlcvRecords = await ohlcvPipeline.execute(assets);
    
    let oiRecords = 0;
    let lsRatioRecords = 0;
    let liquidationRecords = 0;

    if (this.platform !== 'hyperliquid' && this.platform !== 'aster') {
      const oiPipeline = new OpenInterestPipeline(
        this.config,
        this.progressTracker,
        this.rateLimiter,
        this.platformClient,
        this.platform
      );
      oiRecords = await oiPipeline.execute(assets);
    }

    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster') {
      const lsRatioPipeline = new LongShortRatioPipeline(
        this.config,
        this.progressTracker,
        this.rateLimiter,
        this.platformClient,
        this.platform
      );
      lsRatioRecords = await lsRatioPipeline.execute(assets);
    }

    // Liquidation pipeline removed for OKX (deprecated API)
    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster' && this.platform !== 'binance' && this.platform !== 'bybit' && this.platform !== 'okx') {
      const liquidationPipeline = new LiquidationPipeline(
        this.config,
        this.progressTracker,
        this.rateLimiter,
        this.platformClient,
        this.platform
      );
      liquidationRecords = await liquidationPipeline.execute(assets);
    }

    // Update progress tracker counters
    this.progressTracker.setRecordsFetched(fundingRecords);
    this.progressTracker.setOHLCVRecordsFetched(ohlcvRecords);
    this.progressTracker.setOIRecordsFetched(oiRecords);
    this.progressTracker.setLSRatioRecordsFetched(lsRatioRecords);
    this.progressTracker.setLiquidationRecordsFetched(liquidationRecords);
    this.progressTracker.setProcessedAssets(assetCount);

    // Emit complete event
    this.progressTracker.emitProgress('complete', stageOrder[stageOrder.length - 1], 'Incremental fetch complete');

    logger.info(`Incremental fetch complete for ${this.platform}: ${fundingRecords + ohlcvRecords + oiRecords + lsRatioRecords + liquidationRecords} total records`);

    return {
      assetsProcessed: assetCount,
      recordsFetched: fundingRecords,
      ohlcvRecordsFetched: ohlcvRecords,
      oiRecordsFetched: oiRecords,
      lsRatioRecordsFetched: lsRatioRecords,
      liquidationRecordsFetched: liquidationRecords,
      errors: this.progressTracker.getErrors(),
    };
  }
}
