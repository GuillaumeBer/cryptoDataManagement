import { BasePipeline } from './BasePipeline';
import { FetchStage, FundingHistoryRecord } from '../fetchTypes';
import { PlatformClient } from '../PlatformClient';
import { SupportedPlatform } from '../normalizers/platformAssetNormalizer';
import FundingRateRepository from '../../models/FundingRateRepository';
import AssetRepository from '../../models/AssetRepository';
import { CreateFundingRateParams } from '../../models/types';

/**
 * Pipeline for fetching and storing funding rate data
 */
export class FundingPipeline extends BasePipeline {
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
    return 'fundingFetch';
  }

  getStoreStage(): FetchStage {
    return 'fundingStore';
  }

  async execute(assets: string[]): Promise<number> {
    this.startFetchStage('Fetching funding rates...');
    this.startStoreStage('Storing funding rates...');

    let fetchedCount = 0;
    let storedCount = 0;
    let totalRecords = 0;

    await this.platformClient.getFundingHistoryBatch(
      assets,
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
              this.handleError('Funding store', symbol, new Error(`Asset not found: ${symbol}`));
              storedCount++;
              return;
            }

            const records: CreateFundingRateParams[] = data.map((d: FundingHistoryRecord) => ({
              asset_id: asset.id,
              timestamp: d.timestamp,
              funding_rate: d.fundingRate,
              premium: d.premium,
              platform: this.platform,
              sampling_interval: this.config.getSamplingInterval(),
            }));

            const inserted = await FundingRateRepository.bulkInsert(records);
            totalRecords += inserted;
          }

          storedCount++;
          this.updateStoreProgress(storedCount, symbol);
        } catch (err) {
          this.handleError('Funding store', symbol, err);
        }
      }
    );

    this.completeFetchStage();
    this.completeStoreStage();

    return totalRecords;
  }
}
