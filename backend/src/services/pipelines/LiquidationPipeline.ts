import { BasePipeline } from './BasePipeline';
import { FetchStage, PlatformLiquidationRecord } from '../fetchTypes';
import { PlatformClient } from '../PlatformClient';
import { SupportedPlatform } from '../normalizers/platformAssetNormalizer';
import { liquidationRepository } from '../../models/LiquidationRepository';
import AssetRepository from '../../models/AssetRepository';
import { CreateLiquidationParams } from '../../models/types';

/**
 * Pipeline for fetching and storing liquidation event data
 * Only supported on certain platforms (Binance, Bybit, etc.)
 */
export class LiquidationPipeline extends BasePipeline {
  constructor(
    config: any,
    progressTracker: any,
    rateLimiter: any,
    private readonly platformClient: PlatformClient,
    private readonly platform: SupportedPlatform
  ) {
    super(config, progressTracker, rateLimiter);
  }

  getFetchStage(): FetchStage {
    return 'liquidationFetch';
  }

  getStoreStage(): FetchStage {
    return 'liquidationStore';
  }

  /**
   * Skip if platform client doesn't support liquidations
   */
  protected shouldSkip(): boolean {
    return !this.platformClient.getLiquidationsBatch;
  }

  async execute(assets: string[]): Promise<number> {
    if (this.shouldSkip()) {
      // Mark stages as complete without fetching
      this.progressTracker.updateStage(this.getFetchStage(), {
        status: 'complete',
        message: 'Skipped (not supported)',
      });
      this.progressTracker.updateStage(this.getStoreStage(), {
        status: 'complete',
        message: 'Skipped (not supported)',
      });
      return 0;
    }

    this.startFetchStage('Fetching liquidations...');
    this.startStoreStage('Storing liquidations...');

    let fetchedCount = 0;
    let storedCount = 0;
    let totalRecords = 0;

    await this.platformClient.getLiquidationsBatch!(
      assets,
      {
        delayMs: 0, // Controlled by RateLimiter
        concurrency: this.getConcurrency(),
        lookbackDays: 2, // Default lookback
      },
      (symbol, processed) => {
        fetchedCount = processed;
        this.updateFetchProgress(fetchedCount, symbol);
      },
      this.rateLimiter,
      async (symbol, data) => {
        try {
          if (data.length > 0) {
            // Look up asset ID
            const asset = await AssetRepository.findBySymbol(symbol, this.platform);
            if (!asset) {
              this.handleError('Liquidation store', symbol, new Error(`Asset not found: ${symbol}`));
              storedCount++;
              return;
            }

            const records: CreateLiquidationParams[] = data.map((d: PlatformLiquidationRecord) => ({
              asset_id: asset.id,
              timestamp: d.timestamp,
              side: d.side,
              price: d.price,
              quantity: d.quantity,
              volume_usd: d.volumeUsd,
              platform: this.platform,
            }));

            const inserted = await liquidationRepository.bulkInsert(records);
            totalRecords += inserted;
          }

          storedCount++;
          this.updateStoreProgress(storedCount, symbol);
        } catch (err) {
          this.handleError('Liquidation store', symbol, err);
        }
      }
    );

    this.completeFetchStage();
    this.completeStoreStage();

    return totalRecords;
  }
}
