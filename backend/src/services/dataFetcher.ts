import { EventEmitter } from 'events';
import HyperliquidClient from '../api/hyperliquid/client';
import LighterClient from '../api/lighter/client';
import AsterClient from '../api/aster/client';
import EdgeXClient from '../api/edgex/client';
import BinanceClient from '../api/binance/client';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { CreateFundingRateParams } from '../models/types';
import { logger } from '../utils/logger';

// Union type for all platform clients
type PlatformClient = HyperliquidClient | LighterClient | AsterClient | EdgeXClient | BinanceClient;

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
      case 'lighter':
        this.platformClient = new LighterClient();
        break;
      case 'aster':
        this.platformClient = new AsterClient();
        break;
      case 'edgex':
        this.platformClient = new EdgeXClient();
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
        2500, // 2.5s delay - Rate limit: 1200 weight/min, fundingHistory costs ~44 weight (20 base + ~24 for 480 items)
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
        2500, // 2.5s delay to respect Hyperliquid rate limits
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
            this.platform
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
