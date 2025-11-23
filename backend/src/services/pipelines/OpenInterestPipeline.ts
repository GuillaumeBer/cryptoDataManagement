import { BasePipeline } from './BasePipeline';
import { FetchStage, OIRecord } from '../fetchTypes';
import { PlatformClient } from '../PlatformClient';
import { SupportedPlatform } from '../normalizers/platformAssetNormalizer';
import OpenInterestRepository from '../../models/OpenInterestRepository';
import AssetRepository from '../../models/AssetRepository';
import { CreateOpenInterestParams } from '../../models/types';

/**
 * Pipeline for fetching and storing open interest data
 * Note: Some platforms (Hyperliquid, Aster, OKX) only support OI snapshots, not historical data
 */
export class OpenInterestPipeline extends BasePipeline {
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
    return 'oiFetch';
  }

  getStoreStage(): FetchStage {
    return 'oiStore';
  }

  /**
   * Skip OI fetching for snapshot-only platforms during regular fetches
   */
  protected shouldSkip(): boolean {
    return this.config.isSnapshotOnlyOI();
  }

  async execute(assets: string[]): Promise<number> {
    if (this.shouldSkip()) {
      // Mark stages as complete without fetching
      this.progressTracker.updateStage(this.getFetchStage(), {
        status: 'complete',
        message: 'Skipped (snapshot-only platform)',
      });
      this.progressTracker.updateStage(this.getStoreStage(), {
        status: 'complete',
        message: 'Skipped (snapshot-only platform)',
      });
      return 0;
    }

    this.startFetchStage('Fetching open interest...');
    this.startStoreStage('Storing open interest...');

    let fetchedCount = 0;
    let storedCount = 0;
    let totalRecords = 0;

    await this.platformClient.getOpenInterestBatch(
      assets,
      this.config.getOIInterval(),
      0, // Delay controlled by RateLimiter
      this.getConcurrency(),
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
              this.handleError('Open Interest store', symbol, new Error(`Asset not found: ${symbol}`));
              storedCount++;
              return;
            }

            const records: CreateOpenInterestParams[] = data.map((d: OIRecord) => ({
              asset_id: asset.id,
              timestamp: d.timestamp,
              timeframe: '1h', // Platform-specific OI timeframe
              open_interest: d.openInterest,
              open_interest_value: d.openInterestValue,
              platform: this.platform,
            }));

            const inserted = await OpenInterestRepository.bulkInsert(records);
            totalRecords += inserted;
          }

          storedCount++;
          this.updateStoreProgress(storedCount, symbol);
        } catch (err) {
          this.handleError('Open Interest store', symbol, err);
        }
      }
    );

    this.completeFetchStage();
    this.completeStoreStage();

    return totalRecords;
  }
}
