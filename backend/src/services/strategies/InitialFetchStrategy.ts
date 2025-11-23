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
import FundingRateRepository from '../../models/FundingRateRepository';

/**
 * Initial fetch strategy - performs full historical data fetch
 * Fetches all assets and their complete history in parallel
 */
export class InitialFetchStrategy extends FetchStrategy {
  protected getStageOrder(): FetchStage[] {
    const stages: FetchStage[] = [
      'assetDiscovery',
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
    // Only keep for platforms with working liquidation APIs
    if (this.platform !== 'hyperliquid' && this.platform !== 'dydx' && this.platform !== 'aster' && this.platform !== 'binance' && this.platform !== 'bybit' && this.platform !== 'okx') {
      stages.push(
        'liquidationFetch',
        'liquidationStore'
      );
    }

    if (this.shouldResample()) {
      stages.push('resample');
    }

    return stages;
  }

  protected estimateStageTotals(assetCount: number): Partial<Record<FetchStage, number>> {
    const totals: Partial<Record<FetchStage, number>> = {
      assetDiscovery: 1,
      fundingFetch: assetCount,
      fundingStore: assetCount,
      ohlcvFetch: assetCount,
      ohlcvStore: assetCount,
      resample: assetCount,
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
    // Start asset discovery stage
    this.progressTracker.updateStage('assetDiscovery', {
      status: 'active',
      message: 'Discovering assets...',
    });

    // Fetch assets from platform and upsert into DB
    // For dydx, this ensures we only use valid markets returned by the API
    const platformAssets = await this.platformClient.getAssets();
    const normalizedAssets = platformAssets
      .map(asset => normalizePlatformAsset(this.platform, asset))
      .filter((a): a is NonNullable<typeof a> => a !== null);
    
    const upsertedCount = await AssetRepository.bulkUpsert(normalizedAssets);
    logger.info(`Upserted ${upsertedCount} assets for ${this.platform}`);
    this.progressTracker.updateStage('assetDiscovery', {
      status: 'complete',
      completed: 1,
      message: `Discovered ${normalizedAssets.length} assets`,
    });
    return normalizedAssets.map(a => a.symbol);
  }

  async execute(): Promise<FetchResult> {
    // Discover assets
    const assets = await this.getAssets();
    const assetCount = assets.length;

    // Initialize progress tracking
    const stageOrder = this.getStageOrder();
    const stageTotals = this.estimateStageTotals(assetCount);
    this.progressTracker.initialize(stageOrder, stageTotals, assetCount);
    this.progressTracker.setPhase('fetch');
    this.progressTracker.emitProgress('start', 'assetDiscovery', `Starting fetch for ${assetCount} assets`);

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
    // Especially important for Binance which has strict WAF rules
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

    // Resample if needed (Hyperliquid only)
    if (this.shouldResample()) {
      this.progressTracker.setPhase('resample');
      this.progressTracker.updateStage('resample', {
        status: 'active',
        message: 'Generating 8h aggregates...',
      });

      try {
        const { recordsCreated } = await FundingRateRepository.resampleHyperliquidTo8h();
        this.progressTracker.setResampleRecordsCreated(recordsCreated);
        this.progressTracker.setResampleAssetsProcessed(assetCount);

        this.progressTracker.updateStage('resample', {
          status: 'complete',
          completed: assetCount,
          message: `Created ${recordsCreated} 8h records`,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Resampling failed:', errorMsg);
        this.progressTracker.addError(`Resampling failed: ${errorMsg}`);
        this.progressTracker.updateStage('resample', {
          status: 'complete',
          message: 'Resampling failed',
        });
      }
    }

    // Emit complete event
    this.progressTracker.emitProgress('complete', stageOrder[stageOrder.length - 1], 'Fetch complete');

    logger.info(`Initial fetch complete for ${this.platform}: ${fundingRecords + ohlcvRecords + oiRecords + lsRatioRecords + liquidationRecords} total records`);

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
