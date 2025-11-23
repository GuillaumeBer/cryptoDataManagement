import { EventEmitter } from 'events';
import HyperliquidClient from '../api/hyperliquid/client';
import AsterClient from '../api/aster/client';
import BinanceClient from '../api/binance/client';
import BybitClient from '../api/bybit/client';
import OKXClient from '../api/okx/client';
import DyDxClient from '../api/dydx/client';
import AssetRepository from '../models/AssetRepository';
import FundingRateRepository from '../models/FundingRateRepository';
import OHLCVRepository from '../models/OHLCVRepository';
import LongShortRatioRepository from '../models/LongShortRatioRepository';
import { liquidationRepository } from '../models/LiquidationRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { isSupportedPlatform, SupportedPlatform } from './normalizers/platformAssetNormalizer';
import { logger, attachFetchLogTransport, detachFetchLogTransport } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';
import { PlatformClient } from './PlatformClient';
import { PlatformConfig } from './PlatformConfig';
import { ProgressTracker } from './ProgressTracker';
import { InitialFetchStrategy } from './strategies/InitialFetchStrategy';
import { IncrementalFetchStrategy } from './strategies/IncrementalFetchStrategy';
import { ProgressEvent } from './fetchTypes';

// Re-export types for backward compatibility
export type { ProgressPhase, FetchStage, ProgressEvent, ProgressStageSnapshot } from './fetchTypes';

/**
 * DataFetcherService - Facade for data fetching operations
 * Refactored to delegate to strategies and pipelines for better maintainability
 */
export class DataFetcherService extends EventEmitter {
  private platformClient: PlatformClient;
  private platform: SupportedPlatform;
  private config: PlatformConfig;
  private progressTracker: ProgressTracker;
  private rateLimiter: RateLimiter;
  
  private isInitialFetchInProgress = false;
  private isIncrementalFetchInProgress = false;
  private currentProgress: ProgressEvent | null = null;

  constructor(platform: string = 'hyperliquid') {
    super();
    const normalizedPlatform = platform.toLowerCase();

    if (isSupportedPlatform(normalizedPlatform)) {
      this.platform = normalizedPlatform;
    } else {
      logger.warn(`Unsupported platform: ${platform}, defaulting to Hyperliquid`);
      this.platform = 'hyperliquid';
    }

    // Initialize configuration
    this.config = new PlatformConfig(this.platform);

    // Initialize Rate Limiter
    const { capacity, interval } = this.config.getRateLimiterConfig();
    this.rateLimiter = new RateLimiter(capacity, interval);
    logger.info(`RateLimiter initialized for ${this.platform}: ${capacity} tokens per ${interval}ms`);

    // Initialize Progress Tracker
    this.progressTracker = new ProgressTracker();
    
    // Forward progress events from tracker to this service
    this.progressTracker.on('progress', (event: ProgressEvent) => {
      this.currentProgress = event;
      this.emit('progress', event);
    });

    // Initialize platform client
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
      case 'aster':
        this.platformClient = new AsterClient();
        break;
      default:
        this.platformClient = new HyperliquidClient();
    }

    logger.info(`DataFetcherService initialized for platform: ${this.platform}`);
  }

  /**
   * Initial fetch: Get all assets and their full funding history
   * Delegates to InitialFetchStrategy
   */
  async fetchInitialData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    ohlcvRecordsFetched: number;
    oiRecordsFetched: number;
    lsRatioRecordsFetched: number;
    liquidationRecordsFetched: number;
    errors: string[];
  }> {
    if (this.isInitialFetchInProgress) {
      throw new Error('Initial fetch is already in progress');
    }
    if (this.isIncrementalFetchInProgress) {
      throw new Error('Incremental fetch is in progress');
    }

    this.isInitialFetchInProgress = true;
    
    // Attach fetch log transport to capture detailed logs
    const logFile = `logs/fetch-initial-${this.platform}-${Date.now()}.log`;
    const memoryTransport = attachFetchLogTransport(logFile);

    try {
      // Create and execute strategy
      const strategy = new InitialFetchStrategy(
        this.config,
        this.progressTracker,
        this.platformClient,
        this.platform,
        this.rateLimiter
      );

      const result = await strategy.execute();

      // Log to database
      const logEntry = await FetchLogRepository.create(this.platform, 'initial');
      await FetchLogRepository.complete(
        logEntry.id,
        result.errors.length > 0 ? 'partial' : 'success',
        result.assetsProcessed,
        result.recordsFetched,
        result.errors.length > 0 ? result.errors.join('; ') : undefined
      );

      logger.info(`Initial fetch completed for ${this.platform}`, {
        assetsProcessed: result.assetsProcessed,
        recordsFetched: result.recordsFetched,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Initial fetch failed for ${this.platform}:`, errorMsg);
      
      // Log error to database
      const logEntry = await FetchLogRepository.create(this.platform, 'initial');
      await FetchLogRepository.complete(logEntry.id, 'failed', 0, 0, errorMsg);

      throw error;
    } finally {
      detachFetchLogTransport(memoryTransport);
      this.isInitialFetchInProgress = false;
      this.currentProgress = null;
    }
  }

  /**
   * Incremental fetch: Update existing assets with recent data
   * Delegates to IncrementalFetchStrategy
   */
  async fetchIncrementalData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    ohlcvRecordsFetched: number;
    oiRecordsFetched: number;
    lsRatioRecordsFetched: number;
    liquidationRecordsFetched: number;
    errors: string[];
  }> {
    if (this.isIncrementalFetchInProgress) {
      throw new Error('Incremental fetch is already in progress');
    }
    if (this.isInitialFetchInProgress) {
      throw new Error('Initial fetch is in progress');
    }

    this.isIncrementalFetchInProgress = true;

    // Attach fetch log transport
    const logFile = `logs/fetch-incremental-${this.platform}-${Date.now()}.log`;
    const memoryTransport = attachFetchLogTransport(logFile);

    try {
      // Create and execute strategy
      const strategy = new IncrementalFetchStrategy(
        this.config,
        this.progressTracker,
        this.platformClient,
        this.platform,
        this.rateLimiter
      );

      const result = await strategy.execute();

      // Log to database
      const logEntry = await FetchLogRepository.create(this.platform, 'incremental');
      await FetchLogRepository.complete(
        logEntry.id,
        result.errors.length > 0 ? 'partial' : 'success',
        result.assetsProcessed,
        result.recordsFetched,
        result.errors.length > 0 ? result.errors.join('; ') : undefined
      );

      logger.info(`Incremental fetch completed for ${this.platform}`, {
        assetsProcessed: result.assetsProcessed,
        recordsFetched: result.recordsFetched,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Incremental fetch failed for ${this.platform}:`, errorMsg);

      // Log error to database
      const logEntry = await FetchLogRepository.create(this.platform, 'incremental');
      await FetchLogRepository.complete(logEntry.id, 'failed', 0, 0, errorMsg);

      throw error;
    } finally {
      detachFetchLogTransport(memoryTransport);
      this.isIncrementalFetchInProgress = false;
      this.currentProgress = null;
    }
  }

  /**
   * Resample Hyperliquid 1-hour funding rates to 8-hour intervals
   * This creates 8-hour aggregated data to match Binance's interval
   */
  async resampleHyperliquidTo8h(): Promise<{
    assetsProcessed: number;
    recordsCreated: number;
    errors: string[];
  }> {
    if (this.platform !== 'hyperliquid') {
      throw new Error('Resampling is only supported for Hyperliquid platform');
    }

    const errors: string[] = [];
    let assetsProcessed = 0;
    let recordsCreated = 0;

    try {
      const result = await FundingRateRepository.resampleHyperliquidTo8h();
      assetsProcessed = result.assetsProcessed;
      recordsCreated = result.recordsCreated;

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
    const ohlcvCount = await OHLCVRepository.count(this.platform, '1h');
    const lsRatioCount = await LongShortRatioRepository.count(this.platform);
    const liquidationCount = await liquidationRepository.count(this.platform);
    const lastFetch = await FetchLogRepository.getLastSuccessful(this.platform);

    return {
      platform: this.platform,
      assetCount,
      fundingRateCount,
      ohlcvCount,
      lsRatioCount,
      liquidationCount,
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
      rateLimiter: this.rateLimiter.getStats(),
    };
  }

  /**
   * Get current progress (if a fetch is in progress)
   */
  getCurrentProgress(): ProgressEvent | null {
    return this.currentProgress;
  }

  /**
   * Check if any fetch operation is currently in progress
   */
  isFetchInProgress(): boolean {
    return this.isInitialFetchInProgress || this.isIncrementalFetchInProgress;
  }
}

export default DataFetcherService;
