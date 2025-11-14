import { EventEmitter } from 'events';
import HyperliquidClient from '../api/hyperliquid/client';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { CreateFundingRateParams } from '../models/types';
import { logger } from '../utils/logger';

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
  private hyperliquidClient: HyperliquidClient;
  private platform = 'hyperliquid';

  constructor() {
    super();
    this.hyperliquidClient = new HyperliquidClient();
  }

  /**
   * Initial fetch: Get all assets and their full funding history (last 480 hours)
   */
  async fetchInitialData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    errors: string[];
  }> {
    logger.info('Starting initial data fetch from Hyperliquid');

    const fetchLog = await FetchLogRepository.create(this.platform, 'initial');
    let assetsProcessed = 0;
    let recordsFetched = 0;
    const errors: string[] = [];

    try {
      // Step 1: Fetch and store all assets
      logger.info('Fetching assets from Hyperliquid');
      const assets = await this.hyperliquidClient.getAssets();

      await AssetRepository.bulkUpsert(
        assets.map((a) => ({
          symbol: a.name,
          platform: this.platform,
          name: a.name,
        }))
      );

      logger.info(`Stored ${assets.length} assets in database`);

      // Emit start event
      console.log(`[PROGRESS] START: 0/${assets.length} assets`);
      this.emit('progress', {
        type: 'start',
        totalAssets: assets.length,
        processedAssets: 0,
        recordsFetched: 0,
        errors: [],
        percentage: 0,
      } as ProgressEvent);

      // Step 2: Fetch funding history for each asset
      const assetSymbols = assets.map((a) => a.name);
      const fundingDataMap = await this.hyperliquidClient.getFundingHistoryBatch(
        assetSymbols,
        2500, // 2.5s delay - Rate limit: 1200 weight/min, fundingHistory costs ~44 weight (20 base + ~24 for 480 items)
        (currentSymbol: string, processed: number) => {
          // Emit progress event for each asset
          console.log(`[PROGRESS] ${processed}/${assets.length} - Current: ${currentSymbol} (${Math.round((processed / assets.length) * 100)}%)`);
          this.emit('progress', {
            type: 'progress',
            totalAssets: assets.length,
            processedAssets: processed,
            currentAsset: currentSymbol,
            recordsFetched,
            errors,
            percentage: Math.round((processed / assets.length) * 100),
          } as ProgressEvent);
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
      this.emit('progress', {
        type: 'complete',
        totalAssets: assets.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        errors,
        percentage: 100,
      } as ProgressEvent);

      return { assetsProcessed, recordsFetched, errors };
    } catch (error) {
      logger.error('Initial data fetch failed', error);

      // Emit error event
      this.emit('progress', {
        type: 'error',
        totalAssets: 0,
        processedAssets: assetsProcessed,
        recordsFetched,
        errors: [...errors, `${error}`],
        percentage: 0,
      } as ProgressEvent);

      await FetchLogRepository.complete(
        fetchLog.id,
        'failed',
        assetsProcessed,
        recordsFetched,
        `${error}`
      );
      throw error;
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

      // Fetch funding history for each asset
      const assetSymbols = assets.map((a) => a.symbol);
      const fundingDataMap = await this.hyperliquidClient.getFundingHistoryBatch(
        assetSymbols,
        2500 // 2.5s delay to respect Hyperliquid rate limits
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

      return { assetsProcessed, recordsFetched, errors };
    } catch (error) {
      logger.error('Incremental data fetch failed', error);
      await FetchLogRepository.complete(
        fetchLog.id,
        'failed',
        assetsProcessed,
        recordsFetched,
        `${error}`
      );
      throw error;
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
    };
  }
}

export default new DataFetcherService();
