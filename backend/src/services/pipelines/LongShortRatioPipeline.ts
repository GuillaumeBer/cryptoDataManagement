import { BasePipeline } from './BasePipeline';
import { FetchStage, LSRatioRecord } from '../fetchTypes';
import { PlatformClient } from '../PlatformClient';
import { SupportedPlatform } from '../normalizers/platformAssetNormalizer';
import LongShortRatioRepository from '../../models/LongShortRatioRepository';
import AssetRepository from '../../models/AssetRepository';
import { CreateLongShortRatioParams } from '../../models/types';

/**
 * Pipeline for fetching and storing long/short ratio data
 * Only supported on certain platforms (Binance, Bybit, OKX)
 */
export class LongShortRatioPipeline extends BasePipeline {
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
    return 'lsRatioFetch';
  }

  getStoreStage(): FetchStage {
    return 'lsRatioStore';
  }

  /**
   * Skip if platform client doesn't support L/S ratios
   */
  protected shouldSkip(): boolean {
    return !this.platformClient.getLongShortRatioBatch;
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

    this.startFetchStage('Fetching L/S ratios...');
    this.startStoreStage('Storing L/S ratios...');

    let fetchedCount = 0;
    let storedCount = 0;
    let totalRecords = 0;

    await this.platformClient.getLongShortRatioBatch!(
      assets,
      this.config.getLSRatioInterval(),
      this.config.getLSRatioDelay(),
      this.config.getLSRatioConcurrency(),
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
              this.handleError('L/S Ratio store', symbol, new Error(`Asset not found: ${symbol}`));
              storedCount++;
              return;
            }

            const records: CreateLongShortRatioParams[] = data.map((d: LSRatioRecord) => ({
              asset_id: asset.id,
              timestamp: d.timestamp,
              long_ratio: String(d.longRatio),
              short_ratio: String(d.shortRatio),
              long_account: d.longAccount !== undefined ? String(d.longAccount) : null,
              short_account: d.shortAccount !== undefined ? String(d.shortAccount) : null,
              platform: this.platform,
              type: d.type,
              period: d.period,
            }));

            const inserted = await LongShortRatioRepository.bulkUpsert(records);
            totalRecords += inserted;
          }

          storedCount++;
          this.updateStoreProgress(storedCount, symbol);
        } catch (err) {
          this.handleError('L/S Ratio store', symbol, err);
        }
      }
    );

    this.completeFetchStage();
    this.completeStoreStage();

    return totalRecords;
  }
}
