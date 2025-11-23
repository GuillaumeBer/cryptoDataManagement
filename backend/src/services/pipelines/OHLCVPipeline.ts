import { BasePipeline } from './BasePipeline';
import { FetchStage, OHLCVRecord } from '../fetchTypes';
import { PlatformClient } from '../PlatformClient';
import { SupportedPlatform } from '../normalizers/platformAssetNormalizer';
import OHLCVRepository from '../../models/OHLCVRepository';
import AssetRepository from '../../models/AssetRepository';
import { CreateOHLCVParams } from '../../models/types';

/**
 * Pipeline for fetching and storing OHLCV (candlestick) data
 */
export class OHLCVPipeline extends BasePipeline {
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
    return 'ohlcvFetch';
  }

  getStoreStage(): FetchStage {
    return 'ohlcvStore';
  }

  async execute(assets: string[]): Promise<number> {
    this.startFetchStage('Fetching OHLCV data...');
    this.startStoreStage('Storing OHLCV data...');

    let fetchedCount = 0;
    let storedCount = 0;
    let totalRecords = 0;

    await this.platformClient.getOHLCVBatch(
      assets,
      this.config.getOHLCVInterval(),
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
              this.handleError('OHLCV store', symbol, new Error(`Asset not found: ${symbol}`));
              storedCount++;
              return;
            }

            const records: CreateOHLCVParams[] = data.map((d: OHLCVRecord) => ({
              asset_id: asset.id,
              timestamp: d.timestamp,
              timeframe: '1h', // Always 1h for fetched data
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.volume,
              quote_volume: d.quoteVolume,
              trades_count: d.tradesCount,
              platform: this.platform,
            }));

            const inserted = await OHLCVRepository.bulkInsert(records);
            totalRecords += inserted;
          }

          storedCount++;
          this.updateStoreProgress(storedCount, symbol);
        } catch (err) {
          this.handleError('OHLCV store', symbol, err);
        }
      }
    );

    this.completeFetchStage();
    this.completeStoreStage();

    return totalRecords;
  }
}
