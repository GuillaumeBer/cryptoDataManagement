import { EventEmitter } from 'events';
import HyperliquidClient from '../api/hyperliquid/client';
import AsterClient from '../api/aster/client';
import BinanceClient from '../api/binance/client';
import BybitClient from '../api/bybit/client';
import OKXClient from '../api/okx/client';
import DyDxClient from '../api/dydx/client';
import JupiterClient from '../api/jupiter/client';
import GMXClient from '../api/gmx/client';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { CreateFundingRateParams } from '../models/types';
import { logger } from '../utils/logger';

// Union type for all platform clients
type PlatformClient = HyperliquidClient | AsterClient | BinanceClient | BybitClient | OKXClient | DyDxClient | JupiterClient | GMXClient;

export interface ProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  totalAssets: number;
  processedAssets: number;
  currentAsset?: string;
  recordsFetched: number;
  errors: string[];
  percentage: number;
}

export class DataFetcherService extends EventEmitter {
  private platformClient: PlatformClient;
  private platform: string;
  private isInitialFetchInProgress = false;
  private isIncrementalFetchInProgress = false;
  private currentProgress: ProgressEvent | null = null;

  /**
   * Get the sampling interval for each platform
   * - Hyperliquid: 1h (hourly funding, pays 1/8th of 8h rate each hour)
   * - Binance: 8h (tri-daily funding at 00:00, 08:00, 16:00 UTC)
   * - Bybit: 8h (tri-daily funding at 00:00, 08:00, 16:00 UTC)
   * - OKX: 8h (tri-daily funding at 00:00, 08:00, 16:00 UTC)
   * - DyDx V4: 1h (hourly funding)
   * - GMX: 1h (continuous funding, paid hourly)
   * - Jupiter: 1h (placeholder, perpetuals not yet supported)
   * - Aster: 1h (hourly funding)
   */
  private getSamplingInterval(): string {
    switch (this.platform) {
      case 'binance':
      case 'bybit':
      case 'okx':
        return '8h';
      case 'hyperliquid':
      case 'dydx':
      case 'gmx':
      case 'jupiter':
      case 'aster':
      default:
        return '1h';
    }
  }

  /**
   * Get the optimal rate limit delay for each platform
   * Based on official API rate limits
   *
   * - Hyperliquid: 1200 weight/min, fundingHistory ~44 weight → 2500ms delay
   * - Binance: 500 req / 5 min = 100 req/min → 600ms delay
   * - Bybit: TODO - verify actual limits → 600ms default
   * - OKX: TODO - verify actual limits → 600ms default
   * - DyDx V4: TODO - verify actual limits → 100ms default
   * - GMX: TODO - depends on data source (subgraph/API) → 100ms default
   * - Jupiter: TODO - not yet applicable → 100ms default
   * - Aster: 100ms default
   */
  private getRateLimitDelay(): number {
    switch (this.platform) {
      case 'hyperliquid':
        return 2500; // 2.5s delay for Hyperliquid's weight-based limit
      case 'binance':
      case 'bybit':
      case 'okx':
        return 600; // 600ms = 100 req/min (placeholder for Bybit/OKX)
      case 'dydx':
      case 'gmx':
      case 'jupiter':
      case 'aster':
      default:
        return 100;
    }
  }

  constructor(platform: string = 'hyperliquid') {
    super();
    this.platform = platform.toLowerCase();

    // Initialize the correct client based on platform
    switch (this.platform) {
      case 'hyperliquid':
        this.platformClient = new HyperliquidClient();
        break;
      case 'binance':
        this.platformClient = new BinanceClient();
        break;
      case 'bybit':
        this.platformClient = new BybitClient();
        break;
      case 'okx':
        this.platformClient = new OKXClient();
        break;
      case 'dydx':
        this.platformClient = new DyDxClient();
        break;
      case 'gmx':
        this.platformClient = new GMXClient();
        break;
      case 'jupiter':
        this.platformClient = new JupiterClient();
        break;
      case 'aster':
        this.platformClient = new AsterClient();
        break;
      default:
        logger.warn(`Unsupported platform: ${platform}, defaulting to Hyperliquid`);
        this.platform = 'hyperliquid';
        this.platformClient = new HyperliquidClient();
    }

    logger.info(`DataFetcherService initialized for platform: ${this.platform}`);
  }

  /**
   * Check if any fetch operation is currently in progress
   */
  isFetchInProgress(): boolean {
    return this.isInitialFetchInProgress || this.isIncrementalFetchInProgress;
  }

  /**
   * Get current progress (if any fetch is in progress)
   */
  getCurrentProgress(): ProgressEvent | null {
    return this.currentProgress;
  }

  /**
   * Initial fetch: Get all assets and their full funding history (last 480 hours)
   */
  async fetchInitialData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    errors: string[];
  }> {
    // Prevent concurrent fetches
    if (this.isInitialFetchInProgress) {
      throw new Error('Initial fetch is already in progress');
    }
    if (this.isIncrementalFetchInProgress) {
      throw new Error('Incremental fetch is in progress. Please wait for it to complete.');
    }

    this.isInitialFetchInProgress = true;
    logger.info('Starting initial data fetch from Hyperliquid');

    const fetchLog = await FetchLogRepository.create(this.platform, 'initial');
    let assetsProcessed = 0;
    let recordsFetched = 0;
    const errors: string[] = [];

    try {
      // Step 1: Fetch and store all assets
      logger.info(`Fetching assets from ${this.platform}`);
      const assets = await this.platformClient.getAssets();

      // Normalize asset data across platforms
      await AssetRepository.bulkUpsert(
        assets.map((a: any) => {
          // Handle different property names across platforms
          const symbol = a.name || a.symbol;
          return {
            symbol,
            platform: this.platform,
            name: symbol,
          };
        })
      );

      logger.info(`Stored ${assets.length} assets in database`);

      // Emit start event
      console.log(`[PROGRESS] START: 0/${assets.length} assets`);
      this.currentProgress = {
        type: 'start',
        totalAssets: assets.length,
        processedAssets: 0,
        recordsFetched: 0,
        errors: [],
        percentage: 0,
      };
      this.emit('progress', this.currentProgress);

      // Step 2: Fetch funding history for each asset
      const assetSymbols = assets.map((a: any) => a.name || a.symbol);
      const fundingDataMap = await this.platformClient.getFundingHistoryBatch(
        assetSymbols,
        this.getRateLimitDelay(), // Platform-specific rate limit delay
        (currentSymbol: string, processed: number) => {
          // Emit progress event for each asset
          console.log(`[PROGRESS] ${processed}/${assets.length} - Current: ${currentSymbol} (${Math.round((processed / assets.length) * 100)}%)`);
          this.currentProgress = {
            type: 'progress',
            totalAssets: assets.length,
            processedAssets: processed,
            currentAsset: currentSymbol,
            recordsFetched,
            errors,
            percentage: Math.round((processed / assets.length) * 100),
          };
          this.emit('progress', this.currentProgress);
        }
      );

      // Step 3: Store funding rate data
      for (const [symbol, fundingData] of fundingDataMap.entries()) {
        try {
          const asset = await AssetRepository.findBySymbol(symbol, this.platform);
          if (!asset) {
            errors.push(`Asset not found: ${symbol}`);
            continue;
          }

          const records: CreateFundingRateParams[] = fundingData.map((fd) => ({
            asset_id: asset.id,
            timestamp: fd.timestamp,
            funding_rate: fd.fundingRate,
            premium: fd.premium,
            platform: this.platform,
            sampling_interval: this.getSamplingInterval(),
          }));

          const inserted = await FundingRateRepository.bulkInsert(records);
          recordsFetched += inserted;
          assetsProcessed++;

          logger.debug(`Stored ${inserted} records for ${symbol}`);
        } catch (error) {
          const errorMsg = `Failed to store funding data for ${symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      // Update fetch log
      const status = errors.length === 0 ? 'success' : errors.length < assets.length ? 'partial' : 'failed';
      await FetchLogRepository.complete(
        fetchLog.id,
        status,
        assetsProcessed,
        recordsFetched,
        errors.length > 0 ? errors.join('; ') : undefined
      );

      logger.info(
        `Initial fetch completed: ${assetsProcessed} assets, ${recordsFetched} records, ${errors.length} errors`
      );

      // Emit completion event
      console.log(`[PROGRESS] COMPLETE: ${assetsProcessed}/${assets.length} assets, ${recordsFetched} records fetched`);
      this.currentProgress = {
        type: 'complete',
        totalAssets: assets.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        errors,
        percentage: 100,
      };
      this.emit('progress', this.currentProgress);

      return { assetsProcessed, recordsFetched, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Initial data fetch failed:', errorMsg);

      // Emit error event
      this.currentProgress = {
        type: 'error',
        totalAssets: 0,
        processedAssets: assetsProcessed,
        recordsFetched,
        errors: [...errors, errorMsg],
        percentage: 0,
      };
      this.emit('progress', this.currentProgress);

      await FetchLogRepository.complete(
        fetchLog.id,
        'failed',
        assetsProcessed,
        recordsFetched,
        errorMsg
      );
      throw new Error(errorMsg);
    } finally {
      // Always clear the in-progress flag and current progress
      this.isInitialFetchInProgress = false;
      this.currentProgress = null;
    }
  }

  /**
   * Incremental fetch: Get only new funding rates since last fetch
   */
  async fetchIncrementalData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    errors: string[];
  }> {
    // Prevent concurrent fetches
    if (this.isIncrementalFetchInProgress) {
      throw new Error('Incremental fetch is already in progress');
    }
    if (this.isInitialFetchInProgress) {
      throw new Error('Initial fetch is in progress. Please wait for it to complete.');
    }

    this.isIncrementalFetchInProgress = true;
    logger.info('Starting incremental data fetch from Hyperliquid');

    const fetchLog = await FetchLogRepository.create(this.platform, 'incremental');
    let assetsProcessed = 0;
    let recordsFetched = 0;
    const errors: string[] = [];

    try {
      // Get all active assets
      const assets = await AssetRepository.findByPlatform(this.platform);

      if (assets.length === 0) {
        logger.warn('No assets found. Run initial fetch first.');
        await FetchLogRepository.complete(fetchLog.id, 'failed', 0, 0, 'No assets found');
        return { assetsProcessed: 0, recordsFetched: 0, errors: ['No assets found'] };
      }

      // Emit start event
      console.log(`[PROGRESS] INCREMENTAL START: 0/${assets.length} assets`);
      this.currentProgress = {
        type: 'start',
        totalAssets: assets.length,
        processedAssets: 0,
        recordsFetched: 0,
        errors: [],
        percentage: 0,
      };
      this.emit('progress', this.currentProgress);

      // Fetch funding history for each asset
      const assetSymbols = assets.map((a) => a.symbol);
      const fundingDataMap = await this.platformClient.getFundingHistoryBatch(
        assetSymbols,
        this.getRateLimitDelay(), // Platform-specific rate limit delay
        (currentSymbol: string, processed: number) => {
          // Emit progress event for each asset
          console.log(`[PROGRESS] INCREMENTAL ${processed}/${assets.length} - Current: ${currentSymbol} (${Math.round((processed / assets.length) * 100)}%)`);
          this.currentProgress = {
            type: 'progress',
            totalAssets: assets.length,
            processedAssets: processed,
            currentAsset: currentSymbol,
            recordsFetched,
            errors,
            percentage: Math.round((processed / assets.length) * 100),
          };
          this.emit('progress', this.currentProgress);
        }
      );

      // Store only new records
      for (const asset of assets) {
        try {
          const fundingData = fundingDataMap.get(asset.symbol) || [];

          if (fundingData.length === 0) {
            continue;
          }

          // Get latest timestamp we have for this asset
          const latestTimestamp = await FundingRateRepository.getLatestTimestamp(
            asset.id,
            this.platform,
            this.getSamplingInterval()
          );

          // Filter only new records
          const newRecords = latestTimestamp
            ? fundingData.filter((fd) => fd.timestamp > latestTimestamp)
            : fundingData;

          if (newRecords.length === 0) {
            logger.debug(`No new records for ${asset.symbol}`);
            continue;
          }

          const records: CreateFundingRateParams[] = newRecords.map((fd) => ({
            asset_id: asset.id,
            timestamp: fd.timestamp,
            funding_rate: fd.fundingRate,
            premium: fd.premium,
            platform: this.platform,
            sampling_interval: this.getSamplingInterval(),
          }));

          const inserted = await FundingRateRepository.bulkInsert(records);
          recordsFetched += inserted;
          assetsProcessed++;

          logger.debug(`Stored ${inserted} new records for ${asset.symbol}`);
        } catch (error) {
          const errorMsg = `Failed to process ${asset.symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      // Update fetch log
      const status = errors.length === 0 ? 'success' : 'partial';
      await FetchLogRepository.complete(
        fetchLog.id,
        status,
        assetsProcessed,
        recordsFetched,
        errors.length > 0 ? errors.join('; ') : undefined
      );

      logger.info(
        `Incremental fetch completed: ${assetsProcessed} assets, ${recordsFetched} new records, ${errors.length} errors`
      );

      // Emit completion event
      console.log(`[PROGRESS] INCREMENTAL COMPLETE: ${assetsProcessed}/${assets.length} assets, ${recordsFetched} new records fetched`);
      this.currentProgress = {
        type: 'complete',
        totalAssets: assets.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        errors,
        percentage: 100,
      };
      this.emit('progress', this.currentProgress);

      return { assetsProcessed, recordsFetched, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Incremental data fetch failed:', errorMsg);

      // Emit error event
      this.currentProgress = {
        type: 'error',
        totalAssets: 0,
        processedAssets: assetsProcessed,
        recordsFetched,
        errors: [...errors, errorMsg],
        percentage: 0,
      };
      this.emit('progress', this.currentProgress);

      await FetchLogRepository.complete(
        fetchLog.id,
        'failed',
        assetsProcessed,
        recordsFetched,
        errorMsg
      );
      throw new Error(errorMsg);
    } finally {
      // Always clear the in-progress flag and current progress
      this.isIncrementalFetchInProgress = false;
      this.currentProgress = null;
    }
  }

  /**
   * Resample Hyperliquid 1-hour funding rates to 8-hour intervals
   * This creates 8-hour aggregated data to match Binance's interval
   *
   * Methodology:
   * - Hyperliquid computes an 8-hour rate but pays it hourly at 1/8th
   * - To get the 8-hour rate, we sum 8 consecutive hourly rates
   * - Aligned to 00:00, 08:00, 16:00 UTC to match Binance
   */
  async resampleHyperliquidTo8h(): Promise<{
    assetsProcessed: number;
    recordsCreated: number;
    errors: string[];
  }> {
    if (this.platform !== 'hyperliquid') {
      throw new Error('Resampling is only supported for Hyperliquid platform');
    }

    logger.info('Starting 8-hour resampling of Hyperliquid funding rates');
    const errors: string[] = [];
    let assetsProcessed = 0;
    let recordsCreated = 0;

    try {
      // Get all Hyperliquid assets
      const assets = await AssetRepository.findByPlatform('hyperliquid');

      for (const asset of assets) {
        try {
          // Get all 1h funding rates for this asset
          const hourlyRates = await FundingRateRepository.find({
            asset: asset.symbol,
            platform: 'hyperliquid',
            sampling_interval: '1h',
            limit: 100000, // Get all records
          });

          if (hourlyRates.length === 0) {
            continue;
          }

          // Group by 8-hour intervals (aligned to 00:00, 08:00, 16:00 UTC)
          const eightHourBuckets = new Map<number, typeof hourlyRates>();

          for (const rate of hourlyRates) {
            const timestamp = new Date(rate.timestamp);
            const hour = timestamp.getUTCHours();

            // Determine which 8-hour bucket this belongs to
            let bucketHour: number;
            if (hour >= 0 && hour < 8) {
              bucketHour = 0;
            } else if (hour >= 8 && hour < 16) {
              bucketHour = 8;
            } else {
              bucketHour = 16;
            }

            // Create bucket timestamp (start of 8-hour period)
            const bucketTimestamp = new Date(timestamp);
            bucketTimestamp.setUTCHours(bucketHour, 0, 0, 0);
            const bucketKey = bucketTimestamp.getTime();

            if (!eightHourBuckets.has(bucketKey)) {
              eightHourBuckets.set(bucketKey, []);
            }
            eightHourBuckets.get(bucketKey)!.push(rate);
          }

          // Calculate 8-hour rates and insert
          const resampledRecords: CreateFundingRateParams[] = [];

          for (const [bucketTime, rates] of eightHourBuckets.entries()) {
            // Only create 8h record if we have all 8 hours of data
            if (rates.length === 8) {
              // Sum the 8 hourly rates to get the 8-hour rate
              const sum8hRate = rates.reduce(
                (sum, r) => sum + parseFloat(r.funding_rate),
                0
              );

              // Average the premium values
              const avgPremium = rates.reduce(
                (sum, r) => sum + (r.premium ? parseFloat(r.premium) : 0),
                0
              ) / rates.length;

              resampledRecords.push({
                asset_id: asset.id,
                timestamp: new Date(bucketTime),
                funding_rate: sum8hRate.toString(),
                premium: avgPremium.toString(),
                platform: 'hyperliquid',
                sampling_interval: '8h',
              });
            }
          }

          if (resampledRecords.length > 0) {
            const inserted = await FundingRateRepository.bulkInsert(resampledRecords);
            recordsCreated += inserted;
            logger.debug(`Created ${inserted} 8-hour records for ${asset.symbol}`);
          }

          assetsProcessed++;
        } catch (error) {
          const errorMsg = `Failed to resample ${asset.symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      logger.info(
        `Resampling completed: ${assetsProcessed} assets, ${recordsCreated} 8-hour records created`
      );

      return { assetsProcessed, recordsCreated, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Resampling failed:', errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Get system status
   */
  async getStatus() {
    const assetCount = await AssetRepository.count(this.platform);
    const fundingRateCount = await FundingRateRepository.count(this.platform);
    const lastFetch = await FetchLogRepository.getLastSuccessful(this.platform);

    return {
      platform: this.platform,
      assetCount,
      fundingRateCount,
      lastFetch: lastFetch
        ? {
            type: lastFetch.fetch_type,
            completedAt: lastFetch.completed_at,
            recordsFetched: lastFetch.records_fetched,
            assetsProcessed: lastFetch.assets_processed,
          }
        : null,
      fetchInProgress: {
        isInitialFetchInProgress: this.isInitialFetchInProgress,
        isIncrementalFetchInProgress: this.isIncrementalFetchInProgress,
        currentProgress: this.currentProgress,
      },
    };
  }
}
