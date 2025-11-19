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
import OpenInterestRepository from '../models/OpenInterestRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { CreateFundingRateParams, CreateOHLCVParams, CreateOpenInterestParams } from '../models/types';
import {
  normalizePlatformAsset,
  SupportedPlatform,
  PlatformAssetPayload,
  isSupportedPlatform,
} from './normalizers/platformAssetNormalizer';
import { logger } from '../utils/logger';

interface FundingHistoryRecord {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

interface OHLCVRecord {
  asset: string;
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradesCount: number;
}

interface OIRecord {
  asset: string;
  timestamp: Date;
  openInterest: string;
  openInterestValue?: string;
}

// Union type for all platform clients
type PlatformClient = {
  getAssets(): Promise<PlatformAssetPayload[]>;
  getFundingHistoryBatch(
    symbols: string[],
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FundingHistoryRecord[]>>;
  getOHLCVBatch(
    symbols: string[],
    interval?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, OHLCVRecord[]>>;
  getOpenInterestBatch(
    symbols: string[],
    period?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, OIRecord[]>>;
};

export type ProgressPhase = 'fetch' | 'resample';

export type FetchStage =
  | 'assetDiscovery'
  | 'fundingFetch'
  | 'fundingStore'
  | 'ohlcvFetch'
  | 'ohlcvStore'
  | 'oiFetch'
  | 'oiStore'
  | 'resample';

export type StageStatus = 'pending' | 'active' | 'complete';

export interface ProgressStageSnapshot {
  key: FetchStage;
  label: string;
  status: StageStatus;
  completed: number;
  total: number;
  percentage: number;
  currentItem?: string;
  message?: string;
}

export interface ProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  phase: ProgressPhase;
  stage: FetchStage;
  stages: ProgressStageSnapshot[];
  totalAssets: number;
  processedAssets: number;
  currentAsset?: string;
  recordsFetched: number;
  ohlcvRecordsFetched?: number;
  oiRecordsFetched?: number;
  resampleRecordsCreated?: number;
  resampleAssetsProcessed?: number;
  errors: string[];
  percentage: number;
  message?: string;
}

const STAGE_LABELS: Record<FetchStage, string> = {
  assetDiscovery: 'Discover assets',
  fundingFetch: 'Fetch funding rates',
  fundingStore: 'Store funding rates',
  ohlcvFetch: 'Fetch OHLCV data',
  ohlcvStore: 'Store OHLCV data',
  oiFetch: 'Fetch open interest',
  oiStore: 'Store open interest',
  resample: 'Generate 8h aggregates',
};

type StageStateMap = Map<FetchStage, ProgressStageSnapshot>;

const cloneStageSnapshots = (order: FetchStage[], map: StageStateMap): ProgressStageSnapshot[] =>
  order
    .map((key) => {
      const snapshot = map.get(key);
      return snapshot ? { ...snapshot } : undefined;
    })
    .filter((stage): stage is ProgressStageSnapshot => Boolean(stage));

const initializeStageMap = (
  order: FetchStage[],
  totals: Partial<Record<FetchStage, number>>
): StageStateMap => {
  const map: StageStateMap = new Map();
  order.forEach((key) => {
    const total = totals[key] ?? 0;
    map.set(key, {
      key,
      label: STAGE_LABELS[key],
      status: 'pending',
      completed: 0,
      total,
      percentage: 0,
    });
  });
  return map;
};

const updateStage = (
  map: StageStateMap,
  key: FetchStage,
  updates: Partial<ProgressStageSnapshot>
): ProgressStageSnapshot => {
  const current = map.get(key);
  if (!current) {
    throw new Error(`Unknown progress stage: ${key}`);
  }
  const total = updates.total ?? current.total;
  const rawCompleted =
    typeof updates.completed === 'number'
      ? Math.max(0, updates.completed)
      : current.completed;
  const completed = total > 0 ? Math.min(rawCompleted, total) : rawCompleted;
  let percentage = updates.percentage ?? current.percentage;
  if (updates.percentage === undefined) {
    if (total > 0) {
      percentage = Math.min(100, Math.round((completed / total) * 100));
    } else if ((updates.status ?? current.status) === 'complete') {
      percentage = 100;
    } else if (completed > 0) {
      percentage = 100;
    } else {
      percentage = 0;
    }
  }

  const next: ProgressStageSnapshot = {
    ...current,
    ...updates,
    total,
    completed,
    percentage,
  };
  map.set(key, next);
  return next;
};

const calculateOverallPercentage = (map: StageStateMap, order: FetchStage[]): number => {
  let weightedTotal = 0;
  let weightSum = 0;
  order.forEach((key) => {
    const stage = map.get(key);
    if (!stage) {
      return;
    }
    const weight = stage.total > 0 ? stage.total : 1;
    weightSum += weight;
    weightedTotal += stage.percentage * weight;
  });

  if (weightSum === 0) {
    return 0;
  }

  return Math.min(100, Math.round(weightedTotal / weightSum));
};

const INITIAL_STAGE_ORDER: FetchStage[] = [
  'assetDiscovery',
  'fundingFetch',
  'fundingStore',
  'ohlcvFetch',
  'ohlcvStore',
  'oiFetch',
  'oiStore',
];

const INCREMENTAL_STAGE_ORDER: FetchStage[] = [
  'fundingFetch',
  'fundingStore',
  'ohlcvFetch',
  'ohlcvStore',
  'oiFetch',
  'oiStore',
];

interface EmitStageProgressArgs {
  type?: ProgressEvent['type'];
  phase?: ProgressPhase;
  stageKey: FetchStage;
  stageOrder: FetchStage[];
  stageMap: StageStateMap;
  totalAssets: number;
  processedAssets: number;
  recordsFetched: number;
  ohlcvRecordsFetched?: number;
  oiRecordsFetched?: number;
  errors: string[];
  currentAsset?: string;
  message?: string;
  resampleAssetsProcessed?: number;
  resampleRecordsCreated?: number;
}

export class DataFetcherService extends EventEmitter {
  private platformClient: PlatformClient;
  private platform: SupportedPlatform;
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
      case 'aster':
      default:
        return '1h';
    }
  }

  /**
   * Get the OHLCV interval parameter for each platform
   * Each platform uses different formats for 1-hour candles:
   * - Binance: "1h"
   * - Bybit: "60" (minutes)
   * - OKX: "1H"
   * - Hyperliquid: "1h"
   * - DyDx: "1HOUR"
   * - Aster: "1h"
   */
  private getOHLCVInterval(): string | number {
    switch (this.platform) {
      case 'binance':
      case 'hyperliquid':
      case 'aster':
        return '1h';
      case 'bybit':
        return '60'; // Bybit uses minutes
      case 'okx':
        return '1H'; // OKX uses uppercase
      case 'dydx':
        return '1HOUR'; // DyDx uses full word
      default:
        return '1h';
    }
  }

  /**
   * Get the Open Interest interval/period for each platform
   * Platform-specific intervals for OI data fetching:
   * - Binance: "1h" (hourly period)
   * - Bybit: "1h" (hourly interval)
   * - OKX: "1H" (uppercase, hourly period)
   * - Hyperliquid: N/A (snapshot only)
   * - DyDx: "1HOUR" (extracted from candles)
   * - Aster: "1h" (Binance-compatible)
   */
  private getOIInterval(): string | number {
    switch (this.platform) {
      case 'binance':
      case 'aster':
        return '1h';
      case 'bybit':
        return '1h'; // Bybit OI uses '1h' not minutes
      case 'okx':
        return '1H'; // OKX uses uppercase
      case 'dydx':
        return '1HOUR'; // DyDx uses full word
      case 'hyperliquid':
        return '1h'; // Not used (snapshot only), but provide default
      default:
        return '1h';
    }
  }

  /**
   * Get the optimal rate limit delay for each platform
   * Based on official API rate limits with safety margins
   *
   * - Hyperliquid: 1200 weight/min, fundingHistory ~44 weight → 2500ms delay
   * - Binance: 500 req / 5 min = 100 req/min → 700ms delay (~86 req/min, 14% safety margin)
   * - Bybit: 50 req / 2 sec = 1500 req/min → 600ms delay (very safe)
   * - OKX: 20 req / 2 sec = 600 req/min → 600ms delay (safe)
   * - DyDx V4: Strict OHLCV limits → 500ms delay
   * - Aster: Unknown limits → 700ms delay for safety
   */
  private getRateLimitDelay(): number {
    const baseDelay = (() => {
      switch (this.platform) {
        case 'hyperliquid':
          return 2500; // 2.5s delay for Hyperliquid's weight-based limit
        case 'binance':
          return 700; // 700ms = ~86 req/min, 14% safety margin under 100 req/min limit
        case 'bybit':
        case 'okx':
          return 600; // 600ms = 100 req/min (very safe for both platforms)
        case 'dydx':
          return 500; // DyDx has strict rate limits for OHLCV endpoints
        case 'aster':
          return 700; // Conservative delay for unknown limits
        default:
          return 700;
      }
    })();

    // For exchanges with hard per-request limits, scale delay by concurrency so
    // the aggregate throughput stays within the documented rate limits.
    if (['binance', 'bybit', 'okx'].includes(this.platform)) {
      return baseDelay * this.getConcurrencyLimit();
    }

    return baseDelay;
  }

  /**
   * Determine concurrency per platform (overridable via env vars)
   */
  private getConcurrencyLimit(): number {
    const envKey = `${this.platform.toUpperCase()}_FETCH_CONCURRENCY`;
    const envValue = process.env[envKey] || process.env.FETCH_CONCURRENCY;

    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    switch (this.platform) {
      case 'hyperliquid':
        return 2;
      case 'binance':
      case 'bybit':
      case 'okx':
      case 'dydx':
      case 'aster':
        return 1; // Sequential requests for all platforms with strict/unknown rate limits
      default:
        return 1; // Default to sequential for safety
    }
  }

  constructor(platform: string = 'hyperliquid') {
    super();
    const normalizedPlatform = platform.toLowerCase();

    if (isSupportedPlatform(normalizedPlatform)) {
      this.platform = normalizedPlatform;
    } else {
      logger.warn(`Unsupported platform: ${platform}, defaulting to Hyperliquid`);
      this.platform = 'hyperliquid';
    }

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
      case 'aster':
        this.platformClient = new AsterClient();
        break;
      default:
        // TypeScript should never reach this branch, but keep as safeguard
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

  private emitStageProgress(args: EmitStageProgressArgs): void {
    const {
      type = 'progress',
      phase = 'fetch',
      stageKey,
      stageOrder,
      stageMap,
      totalAssets,
      processedAssets,
      recordsFetched,
      ohlcvRecordsFetched,
      errors,
      currentAsset,
      message,
      resampleAssetsProcessed,
      resampleRecordsCreated,
    } = args;

    this.currentProgress = {
      type,
      phase,
      stage: stageKey,
      stages: cloneStageSnapshots(stageOrder, stageMap),
      totalAssets,
      processedAssets,
      currentAsset,
      recordsFetched,
      ohlcvRecordsFetched,
      resampleRecordsCreated,
      resampleAssetsProcessed,
      errors: [...errors],
      percentage: calculateOverallPercentage(stageMap, stageOrder),
      message,
    };
    this.emit('progress', this.currentProgress);
  }

  private async finalizeFetchProgress(context: {
    totalAssets: number;
    assetsProcessed: number;
    recordsFetched: number;
    errors: string[];
    ohlcvRecordsFetched?: number;
    oiRecordsFetched?: number;
    stageState?: {
      order: FetchStage[];
      map: StageStateMap;
    };
  }): Promise<void> {
    const stageOrder = context.stageState?.order ?? [];
    const stageMap = context.stageState?.map;

    if (stageMap) {
      stageOrder.forEach((stageKey) => {
        if (stageKey === 'resample' && this.platform === 'hyperliquid') {
          return;
        }
        updateStage(stageMap, stageKey, { status: 'complete', percentage: 100 });
      });
    }

    if (this.platform !== 'hyperliquid') {
      if (stageMap && stageOrder.length > 0) {
        this.emitStageProgress({
          type: 'complete',
          phase: 'fetch',
          stageKey: stageOrder[stageOrder.length - 1],
          stageOrder,
          stageMap,
          totalAssets: context.totalAssets,
          processedAssets: context.assetsProcessed,
          recordsFetched: context.recordsFetched,
          ohlcvRecordsFetched: context.ohlcvRecordsFetched,
          oiRecordsFetched: context.oiRecordsFetched,
          errors: context.errors,
          message: 'Fetch complete',
        });
      } else {
        this.currentProgress = {
          type: 'complete',
          phase: 'fetch',
          stage: 'ohlcvStore',
          stages: [],
          totalAssets: context.totalAssets,
          processedAssets: context.assetsProcessed,
          recordsFetched: context.recordsFetched,
          ohlcvRecordsFetched: context.ohlcvRecordsFetched,
          errors: context.errors,
          percentage: 100,
        };
        this.emit('progress', this.currentProgress);
      }
      return;
    }

    // Hyperliquid requires an additional resampling step
    let effectiveStageOrder = stageOrder;
    let effectiveStageMap = stageMap;
    if (!effectiveStageMap) {
      effectiveStageOrder = ['resample'];
      effectiveStageMap = initializeStageMap(effectiveStageOrder, { resample: context.totalAssets });
    } else if (!effectiveStageOrder.includes('resample')) {
      effectiveStageOrder = [...effectiveStageOrder, 'resample'];
      updateStage(effectiveStageMap, 'resample', { status: 'pending', completed: 0, total: context.totalAssets });
    }

    updateStage(effectiveStageMap, 'resample', {
      status: 'active',
      completed: 0,
      message: 'Generating 8-hour aggregated data...',
    });

    this.emitStageProgress({
      type: 'progress',
      phase: 'resample',
      stageKey: 'resample',
      stageOrder: effectiveStageOrder,
      stageMap: effectiveStageMap,
      totalAssets: context.totalAssets,
      processedAssets: context.assetsProcessed,
      recordsFetched: context.recordsFetched,
      ohlcvRecordsFetched: context.ohlcvRecordsFetched,
      errors: context.errors,
      message: 'Generating 8-hour aggregated data...',
    });

    try {
      const { assetsProcessed, recordsCreated } = await this.resampleHyperliquidTo8h();
      updateStage(effectiveStageMap, 'resample', {
        status: 'complete',
        completed: assetsProcessed,
        total: Math.max(assetsProcessed, context.totalAssets),
        message: 'Fetch and resampling complete',
      });

      this.emitStageProgress({
        type: 'complete',
        phase: 'resample',
        stageKey: 'resample',
        stageOrder: effectiveStageOrder,
        stageMap: effectiveStageMap,
        totalAssets: context.totalAssets,
        processedAssets: context.assetsProcessed,
        recordsFetched: context.recordsFetched,
        ohlcvRecordsFetched: context.ohlcvRecordsFetched,
        errors: context.errors,
        resampleAssetsProcessed: assetsProcessed,
        resampleRecordsCreated: recordsCreated,
        message: 'Fetch and resampling complete',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      context.errors.push(errorMsg);
      updateStage(effectiveStageMap, 'resample', {
        status: 'active',
        message: 'Resampling failed',
      });
      this.emitStageProgress({
        type: 'error',
        phase: 'resample',
        stageKey: 'resample',
        stageOrder: effectiveStageOrder,
        stageMap: effectiveStageMap,
        totalAssets: context.totalAssets,
        processedAssets: context.assetsProcessed,
        recordsFetched: context.recordsFetched,
        ohlcvRecordsFetched: context.ohlcvRecordsFetched,
        errors: context.errors,
        message: 'Resampling failed',
      });
      throw error;
    }
  }

  /**
   * Initial fetch: Get all assets and their full funding history (last 480 hours)
   */
  async fetchInitialData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    ohlcvRecordsFetched: number;
    oiRecordsFetched: number;
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
    logger.info(`Starting initial data fetch from ${this.platform}`);

    const fetchLog = await FetchLogRepository.create(this.platform, 'initial');
    let assetsProcessed = 0;
    let recordsFetched = 0;
    let ohlcvRecordsFetched = 0;
    const errors: string[] = [];
    let stageState: { order: FetchStage[]; map: StageStateMap } | null = null;
    let assetSymbols: string[] = [];

    try {
      // Step 1: Fetch and store all assets
      logger.info(`Fetching assets from ${this.platform}`);
      const assets = await this.platformClient.getAssets();

      // Normalize asset data across platforms
      const normalizedAssets = assets.flatMap((asset: PlatformAssetPayload) => {
        const normalized = normalizePlatformAsset(this.platform, asset);
        return normalized ? [normalized] : [];
      });

      // Deduplicate assets by symbol to avoid "ON CONFLICT DO UPDATE cannot affect row a second time" error
      const uniqueAssets = Array.from(
        new Map(normalizedAssets.map((asset) => [asset.symbol, asset])).values()
      );

      logger.info(`Normalized ${assets.length} assets, ${uniqueAssets.length} unique symbols`);
      await AssetRepository.bulkUpsert(uniqueAssets);
      await AssetRepository.deactivateMissingSymbols(
        this.platform,
        uniqueAssets.map((asset) => asset.symbol)
      );

      logger.info(`Stored ${uniqueAssets.length} unique assets in database`);

      // Step 2: Fetch funding history for each unique asset
      // Use unique symbols to match what we stored in the database
      assetSymbols = uniqueAssets.map((a) => a.symbol);

      // Build symbol -> assetId map once we have the latest DB snapshot
      const storedAssets = await AssetRepository.findByPlatform(this.platform);
      const assetMap = new Map(storedAssets.map((asset) => [asset.symbol, asset.id]));

      const stageOrder =
        this.platform === 'hyperliquid' ? [...INITIAL_STAGE_ORDER, 'resample'] : [...INITIAL_STAGE_ORDER];
      const stageTotals: Partial<Record<FetchStage, number>> = {
        assetDiscovery: uniqueAssets.length,
        fundingFetch: assetSymbols.length,
        fundingStore: assetSymbols.length,
        ohlcvFetch: assetSymbols.length,
        ohlcvStore: assetSymbols.length,
        oiFetch: assetSymbols.length,
        oiStore: assetSymbols.length,
      };
      if (this.platform === 'hyperliquid') {
        stageTotals.resample = assetSymbols.length;
      }
      const stageMap = initializeStageMap(stageOrder, stageTotals);
      stageState = { order: stageOrder, map: stageMap };

      updateStage(stageMap, 'assetDiscovery', {
        status: 'active',
        completed: 0,
        message: 'Preparing asset list...',
      });
      logger.info(`[PROGRESS] START: 0/${assetSymbols.length} assets`);
      this.emitStageProgress({
        type: 'start',
        stageKey: 'assetDiscovery',
        stageOrder,
        stageMap,
        totalAssets: assetSymbols.length,
        processedAssets: 0,
        recordsFetched: 0,
        ohlcvRecordsFetched: 0,
        errors,
        message: 'Preparing asset list...',
      });
      updateStage(stageMap, 'assetDiscovery', {
        completed: uniqueAssets.length,
        status: 'complete',
        message: `Stored ${uniqueAssets.length} unique assets`,
      });
      this.emitStageProgress({
        stageKey: 'assetDiscovery',
        stageOrder,
        stageMap,
        totalAssets: assetSymbols.length,
        processedAssets: 0,
        recordsFetched: 0,
        ohlcvRecordsFetched: 0,
        errors,
        message: `Stored ${uniqueAssets.length} unique assets`,
      });

      updateStage(stageMap, 'fundingFetch', {
        status: 'active',
        message: 'Fetching funding rates...',
      });
      const fundingDataMap = await this.platformClient.getFundingHistoryBatch(
        assetSymbols,
        this.getRateLimitDelay(), // Platform-specific rate limit delay
        this.getConcurrencyLimit(),
        (currentSymbol: string, processed: number) => {
          // Emit progress event for each asset
          updateStage(stageMap, 'fundingFetch', {
            completed: processed,
            currentItem: currentSymbol,
          });
          logger.debug('[PROGRESS] Asset fetch progress', {
            processed,
            total: assetSymbols.length,
            currentSymbol,
            percentage: Math.round((processed / assetSymbols.length) * 100),
          });
          this.emitStageProgress({
            stageKey: 'fundingFetch',
            stageOrder,
            stageMap,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            currentAsset: currentSymbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Fetching funding rates...',
          });
        }
      );
      updateStage(stageMap, 'fundingFetch', {
        completed: assetSymbols.length,
        status: 'complete',
        currentItem: undefined,
        message: 'Funding rates fetched',
      });

      // Step 3: Store funding rate data
      updateStage(stageMap, 'fundingStore', {
        status: 'active',
        message: 'Storing funding rates...',
      });
      let fundingStoreProgress = 0;
      for (const [symbol, fundingData] of fundingDataMap.entries()) {
        try {
          const assetId = assetMap.get(symbol);
          if (!assetId) {
            errors.push(`Asset not found: ${symbol}`);
            continue;
          }

          const records: CreateFundingRateParams[] = fundingData.map((fd) => ({
            asset_id: assetId,
            timestamp: fd.timestamp,
            funding_rate: fd.fundingRate,
            premium: fd.premium,
            platform: this.platform,
            sampling_interval: this.getSamplingInterval(),
          }));

          const inserted = await FundingRateRepository.bulkInsert(records);
          recordsFetched += inserted;
          assetsProcessed++;

          logger.debug(`Stored ${inserted} funding rate records for ${symbol}`);
        } catch (error) {
          const errorMsg = `Failed to store funding data for ${symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } finally {
          fundingStoreProgress++;
          updateStage(stageMap, 'fundingStore', {
            completed: fundingStoreProgress,
            currentItem: symbol,
          });
          this.emitStageProgress({
            stageKey: 'fundingStore',
            stageOrder,
            stageMap,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            currentAsset: symbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Storing funding rates...',
          });
        }
      }
      updateStage(stageMap, 'fundingStore', {
        status: 'complete',
        completed: assetSymbols.length,
        currentItem: undefined,
        message: 'Funding rates stored',
      });
      this.emitStageProgress({
        stageKey: 'fundingStore',
        stageOrder,
        stageMap,
        totalAssets: assetSymbols.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        errors,
        message: 'Funding rates stored',
      });

      // Step 4: Fetch and store OHLCV data
      logger.info(`Fetching OHLCV data for ${assetSymbols.length} assets from ${this.platform}`);
      let ohlcvAssetsProcessed = 0;
      updateStage(stageMap, 'ohlcvFetch', {
        status: 'active',
        message: 'Fetching OHLCV candles...',
      });

      const ohlcvDataMap = await this.platformClient.getOHLCVBatch(
        assetSymbols,
        this.getOHLCVInterval(),
        this.getRateLimitDelay(),
        this.getConcurrencyLimit(),
        (currentSymbol: string, processed: number) => {
          updateStage(stageMap, 'ohlcvFetch', {
            completed: processed,
            currentItem: currentSymbol,
          });
          logger.debug('[PROGRESS] OHLCV fetch progress', {
            processed,
            total: assetSymbols.length,
            currentSymbol,
            percentage: Math.round((processed / assetSymbols.length) * 100),
          });
          this.emitStageProgress({
            stageKey: 'ohlcvFetch',
            stageOrder,
            stageMap,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            currentAsset: currentSymbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Fetching OHLCV candles...',
          });
        }
      );
      updateStage(stageMap, 'ohlcvFetch', {
        completed: assetSymbols.length,
        status: 'complete',
        currentItem: undefined,
        message: 'OHLCV data fetched',
      });

      // Step 5: Store OHLCV data
      updateStage(stageMap, 'ohlcvStore', {
        status: 'active',
        message: 'Storing OHLCV candles...',
      });
      let ohlcvStoreProgress = 0;
      for (const [symbol, ohlcvData] of ohlcvDataMap.entries()) {
        try {
          const assetId = assetMap.get(symbol);
          if (!assetId) {
            errors.push(`Asset not found for OHLCV: ${symbol}`);
            continue;
          }

          const records: CreateOHLCVParams[] = ohlcvData.map((data) => ({
            asset_id: assetId,
            timestamp: data.timestamp,
            timeframe: '1h',
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            volume: data.volume,
            quote_volume: data.quoteVolume,
            trades_count: data.tradesCount,
            platform: this.platform,
          }));

          const inserted = await OHLCVRepository.bulkInsert(records);
          ohlcvRecordsFetched += inserted;
          ohlcvAssetsProcessed++;

          logger.debug(`Stored ${inserted} OHLCV records for ${symbol}`);
        } catch (error) {
          const errorMsg = `Failed to store OHLCV data for ${symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } finally {
          ohlcvStoreProgress++;
          updateStage(stageMap, 'ohlcvStore', {
            completed: ohlcvStoreProgress,
            currentItem: symbol,
          });
          this.emitStageProgress({
            stageKey: 'ohlcvStore',
            stageOrder,
            stageMap,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            currentAsset: symbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Storing OHLCV candles...',
          });
        }
      }
      updateStage(stageMap, 'ohlcvStore', {
        status: 'complete',
        completed: assetSymbols.length,
        currentItem: undefined,
        message: 'OHLCV data stored',
      });
      this.emitStageProgress({
        stageKey: 'ohlcvStore',
        stageOrder,
        stageMap,
        totalAssets: assetSymbols.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        errors,
        message: 'OHLCV data stored',
      });

      // Step 6: Fetch Open Interest data
      let oiRecordsFetched = 0;
      let oiAssetsProcessed = 0;
      logger.info(`Fetching Open Interest data for ${assetSymbols.length} assets from ${this.platform}`);

      updateStage(stageMap, 'oiFetch', {
        status: 'active',
        message: 'Fetching Open Interest data...',
      });

      const oiDataMap = await this.platformClient.getOpenInterestBatch(
        assetSymbols,
        this.getOIInterval(),
        this.getRateLimitDelay(),
        this.getConcurrencyLimit(),
        (currentSymbol: string, processed: number) => {
          updateStage(stageMap, 'oiFetch', {
            completed: processed,
            currentItem: currentSymbol,
          });
          this.emitStageProgress({
            stageKey: 'oiFetch',
            stageOrder,
            stageMap,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            currentAsset: currentSymbol,
            recordsFetched,
            ohlcvRecordsFetched,
            oiRecordsFetched: 0,
            errors,
            message: 'Fetching Open Interest data...',
          });
        }
      );
      updateStage(stageMap, 'oiFetch', {
        completed: assetSymbols.length,
        status: 'complete',
        currentItem: undefined,
        message: 'Open Interest data fetched',
      });

      // Step 7: Store Open Interest data
      updateStage(stageMap, 'oiStore', {
        status: 'active',
        message: 'Storing Open Interest data...',
      });
      let oiStoreProgress = 0;
      for (const [symbol, oiData] of oiDataMap.entries()) {
        try {
          const assetId = assetMap.get(symbol);
          if (!assetId) {
            errors.push(`Asset not found for Open Interest: ${symbol}`);
            continue;
          }

          const records: CreateOpenInterestParams[] = oiData.map((data) => ({
            asset_id: assetId,
            timestamp: data.timestamp,
            timeframe: '1h',
            open_interest: data.openInterest,
            open_interest_value: data.openInterestValue,
            platform: this.platform,
          }));

          const inserted = await OpenInterestRepository.bulkInsert(records);
          oiRecordsFetched += inserted;
          oiAssetsProcessed++;

          logger.debug(`Stored ${inserted} Open Interest records for ${symbol}`);
        } catch (error) {
          const errorMsg = `Failed to store Open Interest data for ${symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } finally {
          oiStoreProgress++;
          updateStage(stageMap, 'oiStore', {
            completed: oiStoreProgress,
            currentItem: symbol,
          });
          this.emitStageProgress({
            stageKey: 'oiStore',
            stageOrder,
            stageMap,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            currentAsset: symbol,
            recordsFetched,
            ohlcvRecordsFetched,
            oiRecordsFetched,
            errors,
            message: 'Storing Open Interest data...',
          });
        }
      }
      updateStage(stageMap, 'oiStore', {
        status: 'complete',
        completed: assetSymbols.length,
        currentItem: undefined,
        message: 'Open Interest data stored',
      });
      this.emitStageProgress({
        stageKey: 'oiStore',
        stageOrder,
        stageMap,
        totalAssets: assetSymbols.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        oiRecordsFetched,
        errors,
        message: 'Open Interest data stored',
      });

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
        `Initial fetch completed: ${assetsProcessed} assets, ${recordsFetched} funding rate records, ${ohlcvRecordsFetched} OHLCV records, ${oiRecordsFetched} OI records, ${errors.length} errors`
      );

      // Emit completion/resampling events
      logger.info(`[PROGRESS] COMPLETE: ${assetsProcessed}/${assets.length} assets, ${recordsFetched} funding rate records, ${ohlcvRecordsFetched} OHLCV records, ${oiRecordsFetched} OI records fetched`);
      await this.finalizeFetchProgress({
        totalAssets: assets.length,
        assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        oiRecordsFetched,
        errors,
        stageState: stageState ?? undefined,
      });

      return { assetsProcessed, recordsFetched, ohlcvRecordsFetched, oiRecordsFetched, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Initial data fetch failed:', errorMsg);

      // Emit error event
      if (this.currentProgress?.type !== 'error') {
        const allErrors = [...errors, errorMsg];
        if (stageState) {
          const stageKey = this.currentProgress?.stage ?? stageState.order[0] ?? 'fundingFetch';
          this.emitStageProgress({
            type: 'error',
            stageKey,
            stageOrder: stageState.order,
            stageMap: stageState.map,
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            recordsFetched,
            ohlcvRecordsFetched,
            errors: allErrors,
            message: errorMsg,
          });
        } else {
          this.currentProgress = {
            type: 'error',
            phase: 'fetch',
            stage: 'fundingFetch',
            stages: [],
            totalAssets: assetSymbols.length,
            processedAssets: assetsProcessed,
            recordsFetched,
            errors: allErrors,
            percentage: 0,
            message: errorMsg,
          };
          this.emit('progress', this.currentProgress);
        }
      }

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
   * Incremental fetch: Get only new funding rates and OHLCV data since last fetch
   */
  async fetchIncrementalData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    ohlcvRecordsFetched: number;
    oiRecordsFetched: number;
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
    logger.info(`Starting incremental data fetch from ${this.platform}`);

    const fetchLog = await FetchLogRepository.create(this.platform, 'incremental');
    let assetsProcessed = 0;
    let recordsFetched = 0;
    let ohlcvRecordsFetched = 0;
    let oiRecordsFetched = 0;
    const errors: string[] = [];
    let stageState: { order: FetchStage[]; map: StageStateMap } | null = null;
    let totalAssetsTarget = 0;

    try {
      // Get all active assets
      const assets = await AssetRepository.findByPlatform(this.platform);
      totalAssetsTarget = assets.length;

      if (assets.length === 0) {
        logger.warn('No assets found. Run initial fetch first.');
        await FetchLogRepository.complete(fetchLog.id, 'failed', 0, 0, 'No assets found');
        return { assetsProcessed: 0, recordsFetched: 0, ohlcvRecordsFetched: 0, oiRecordsFetched: 0, errors: ['No assets found'] };
      }

      const stageOrder =
        this.platform === 'hyperliquid'
          ? [...INCREMENTAL_STAGE_ORDER, 'resample']
          : [...INCREMENTAL_STAGE_ORDER];
      const stageTotals: Partial<Record<FetchStage, number>> = {
        fundingFetch: assets.length,
        fundingStore: assets.length,
        ohlcvFetch: assets.length,
        ohlcvStore: assets.length,
        oiFetch: assets.length,
        oiStore: assets.length,
      };
      if (this.platform === 'hyperliquid') {
        stageTotals.resample = assets.length;
      }
      const stageMap = initializeStageMap(stageOrder, stageTotals);
      stageState = { order: stageOrder, map: stageMap };

      // Emit start event
      logger.info(`[PROGRESS] INCREMENTAL START: 0/${assets.length} assets`);
      updateStage(stageMap, 'fundingFetch', {
        status: 'active',
        message: 'Fetching funding updates...',
      });
      this.emitStageProgress({
        type: 'start',
        stageKey: 'fundingFetch',
        stageOrder,
        stageMap,
        totalAssets: assets.length,
        processedAssets: 0,
        recordsFetched: 0,
        ohlcvRecordsFetched: 0,
        errors,
        message: 'Fetching funding updates...',
      });

      // Fetch funding history for each asset
      const assetSymbols = assets.map((a) => a.symbol);
      const fundingDataMap = await this.platformClient.getFundingHistoryBatch(
        assetSymbols,
        this.getRateLimitDelay(), // Platform-specific rate limit delay
        this.getConcurrencyLimit(),
        (currentSymbol: string, processed: number) => {
          // Emit progress event for each asset
          updateStage(stageMap, 'fundingFetch', {
            completed: processed,
            currentItem: currentSymbol,
          });
          logger.debug('[PROGRESS] Incremental fetch progress', {
            processed,
            total: assets.length,
            currentSymbol,
            percentage: Math.round((processed / assets.length) * 100),
          });
          this.emitStageProgress({
            stageKey: 'fundingFetch',
            stageOrder,
            stageMap,
            totalAssets: assets.length,
            processedAssets: assetsProcessed,
            currentAsset: currentSymbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Fetching funding updates...',
          });
        }
      );
      updateStage(stageMap, 'fundingFetch', {
        completed: assets.length,
        status: 'complete',
        currentItem: undefined,
        message: 'Funding data fetched',
      });

      const latestTimestampMap = await FundingRateRepository.getLatestTimestamps(
        assets.map((asset) => asset.id),
        this.platform,
        this.getSamplingInterval()
      );

      // Store only new records
      updateStage(stageMap, 'fundingStore', {
        status: 'active',
        message: 'Storing funding updates...',
      });
      let fundingStoreProgress = 0;
      for (const asset of assets) {
        try {
          const fundingData = fundingDataMap.get(asset.symbol) || [];

          if (fundingData.length === 0) {
            continue;
          }

          // Get latest timestamp we have for this asset
          const latestTimestamp = latestTimestampMap.get(asset.id) || null;

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

          logger.debug(`Stored ${inserted} new funding rate records for ${asset.symbol}`);
        } catch (error) {
          const errorMsg = `Failed to process funding rate for ${asset.symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } finally {
          fundingStoreProgress++;
          updateStage(stageMap, 'fundingStore', {
            completed: fundingStoreProgress,
            currentItem: asset.symbol,
          });
          this.emitStageProgress({
            stageKey: 'fundingStore',
            stageOrder,
            stageMap,
            totalAssets: assets.length,
            processedAssets: assetsProcessed,
            currentAsset: asset.symbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Storing funding updates...',
          });
        }
      }
      updateStage(stageMap, 'fundingStore', {
        completed: assets.length,
        status: 'complete',
        currentItem: undefined,
        message: 'Funding updates stored',
      });
      this.emitStageProgress({
        stageKey: 'fundingStore',
        stageOrder,
        stageMap,
        totalAssets: assets.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        errors,
        message: 'Funding updates stored',
      });

      // Fetch and store OHLCV data
      logger.info(`Fetching OHLCV data for ${assets.length} assets from ${this.platform}`);
      let ohlcvAssetsProcessed = 0;
      updateStage(stageMap, 'ohlcvFetch', {
        status: 'active',
        message: 'Fetching OHLCV updates...',
      });
      const ohlcvDataMap = await this.platformClient.getOHLCVBatch(
        assetSymbols,
        this.getOHLCVInterval(),
        this.getRateLimitDelay(),
        this.getConcurrencyLimit(),
        (currentSymbol: string, processed: number) => {
          updateStage(stageMap, 'ohlcvFetch', {
            completed: processed,
            currentItem: currentSymbol,
          });
          logger.debug('[PROGRESS] OHLCV incremental fetch progress', {
            processed,
            total: assets.length,
            currentSymbol,
            percentage: Math.round((processed / assets.length) * 100),
          });
          this.emitStageProgress({
            stageKey: 'ohlcvFetch',
            stageOrder,
            stageMap,
            totalAssets: assets.length,
            processedAssets: assetsProcessed,
            currentAsset: currentSymbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Fetching OHLCV updates...',
          });
        }
      );
      updateStage(stageMap, 'ohlcvFetch', {
        completed: assets.length,
        status: 'complete',
        currentItem: undefined,
        message: 'OHLCV updates fetched',
      });

      const latestOHLCVTimestampMap = await OHLCVRepository.getLatestTimestamps(
        assets.map((asset) => asset.id),
        this.platform,
        '1h'
      );

      // Store only new OHLCV records
      updateStage(stageMap, 'ohlcvStore', {
        status: 'active',
        message: 'Storing OHLCV updates...',
      });
      let ohlcvStoreProgress = 0;
      for (const asset of assets) {
        try {
          const ohlcvData = ohlcvDataMap.get(asset.symbol) || [];

          if (ohlcvData.length === 0) {
            continue;
          }

          // Get latest timestamp we have for this asset
          const latestTimestamp = latestOHLCVTimestampMap.get(asset.id) || null;

          // Filter only new records
          const newRecords = latestTimestamp
            ? ohlcvData.filter((data) => data.timestamp > latestTimestamp)
            : ohlcvData;

          if (newRecords.length === 0) {
            logger.debug(`No new OHLCV records for ${asset.symbol}`);
            continue;
          }

          const records: CreateOHLCVParams[] = newRecords.map((data) => ({
            asset_id: asset.id,
            timestamp: data.timestamp,
            timeframe: '1h',
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            volume: data.volume,
            quote_volume: data.quoteVolume,
            trades_count: data.tradesCount,
            platform: this.platform,
          }));

          const inserted = await OHLCVRepository.bulkInsert(records);
          ohlcvRecordsFetched += inserted;
          ohlcvAssetsProcessed++;

          logger.debug(`Stored ${inserted} new OHLCV records for ${asset.symbol}`);
        } catch (error) {
          const errorMsg = `Failed to process OHLCV for ${asset.symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } finally {
          ohlcvStoreProgress++;
          updateStage(stageMap, 'ohlcvStore', {
            completed: ohlcvStoreProgress,
            currentItem: asset.symbol,
          });
          this.emitStageProgress({
            stageKey: 'ohlcvStore',
            stageOrder,
            stageMap,
            totalAssets: assets.length,
            processedAssets: assetsProcessed,
            currentAsset: asset.symbol,
            recordsFetched,
            ohlcvRecordsFetched,
            errors,
            message: 'Storing OHLCV updates...',
          });
        }
      }
      updateStage(stageMap, 'ohlcvStore', {
        completed: assets.length,
        status: 'complete',
        currentItem: undefined,
        message: 'OHLCV updates stored',
      });
      this.emitStageProgress({
        stageKey: 'ohlcvStore',
        stageOrder,
        stageMap,
        totalAssets: assets.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        errors,
        message: 'OHLCV updates stored',
      });

      // Step 6: Fetch Open Interest updates
      let oiAssetsProcessed = 0;
      let oiRecordsFetched = 0;
      logger.info(`Fetching Open Interest updates for ${assets.length} assets from ${this.platform}`);

      // Build symbol -> assetId map for OI data storage
      const assetMap = new Map(assets.map((asset) => [asset.symbol, asset.id]));

      updateStage(stageMap, 'oiFetch', {
        status: 'active',
        message: 'Fetching Open Interest updates...',
      });

      const oiDataMap = await this.platformClient.getOpenInterestBatch(
        assetSymbols,
        this.getOIInterval(),
        this.getRateLimitDelay(),
        this.getConcurrencyLimit(),
        (currentSymbol: string, processed: number) => {
          updateStage(stageMap, 'oiFetch', {
            completed: processed,
            currentItem: currentSymbol,
          });
          this.emitStageProgress({
            stageKey: 'oiFetch',
            stageOrder,
            stageMap,
            totalAssets: assets.length,
            processedAssets: assetsProcessed,
            currentAsset: currentSymbol,
            recordsFetched,
            ohlcvRecordsFetched,
            oiRecordsFetched: 0,
            errors,
            message: 'Fetching Open Interest updates...',
          });
        }
      );
      updateStage(stageMap, 'oiFetch', {
        completed: assets.length,
        status: 'complete',
        currentItem: undefined,
        message: 'Open Interest updates fetched',
      });

      // Step 7: Store Open Interest updates
      updateStage(stageMap, 'oiStore', {
        status: 'active',
        message: 'Storing Open Interest updates...',
      });
      let oiStoreProgress = 0;
      for (const [symbol, oiData] of oiDataMap.entries()) {
        try {
          const assetId = assetMap.get(symbol);
          if (!assetId) {
            errors.push(`Asset not found for Open Interest: ${symbol}`);
            continue;
          }

          const records: CreateOpenInterestParams[] = oiData.map((data) => ({
            asset_id: assetId,
            timestamp: data.timestamp,
            timeframe: '1h',
            open_interest: data.openInterest,
            open_interest_value: data.openInterestValue,
            platform: this.platform,
          }));

          const inserted = await OpenInterestRepository.bulkInsert(records);
          oiRecordsFetched += inserted;
          oiAssetsProcessed++;

          logger.debug(`Stored ${inserted} Open Interest records for ${symbol}`);
        } catch (error) {
          const errorMsg = `Failed to store Open Interest data for ${symbol}: ${error}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } finally {
          oiStoreProgress++;
          updateStage(stageMap, 'oiStore', {
            completed: oiStoreProgress,
            currentItem: symbol,
          });
          this.emitStageProgress({
            stageKey: 'oiStore',
            stageOrder,
            stageMap,
            totalAssets: assets.length,
            processedAssets: assetsProcessed,
            currentAsset: symbol,
            recordsFetched,
            ohlcvRecordsFetched,
            oiRecordsFetched,
            errors,
            message: 'Storing Open Interest updates...',
          });
        }
      }
      updateStage(stageMap, 'oiStore', {
        status: 'complete',
        completed: assets.length,
        currentItem: undefined,
        message: 'Open Interest updates stored',
      });
      this.emitStageProgress({
        stageKey: 'oiStore',
        stageOrder,
        stageMap,
        totalAssets: assets.length,
        processedAssets: assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        oiRecordsFetched,
        errors,
        message: 'Open Interest updates stored',
      });

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
        `Incremental fetch completed: ${assetsProcessed} assets, ${recordsFetched} new funding rate records, ${ohlcvRecordsFetched} new OHLCV records, ${oiRecordsFetched} new OI records, ${errors.length} errors`
      );

      // Emit completion/resampling events
      logger.info(
        `[PROGRESS] INCREMENTAL COMPLETE: ${assetsProcessed}/${assets.length} assets, ${recordsFetched} funding rate records, ${ohlcvRecordsFetched} OHLCV records, ${oiRecordsFetched} OI records fetched`
      );
      await this.finalizeFetchProgress({
        totalAssets: assets.length,
        assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        oiRecordsFetched,
        errors,
        stageState: stageState ?? undefined,
      });

      return { assetsProcessed, recordsFetched, ohlcvRecordsFetched, oiRecordsFetched, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Incremental data fetch failed:', errorMsg);

      // Emit error event
      if (this.currentProgress?.type !== 'error') {
        const allErrors = [...errors, errorMsg];
        if (stageState) {
          const stageKey = this.currentProgress?.stage ?? stageState.order[0] ?? 'fundingFetch';
          this.emitStageProgress({
            type: 'error',
            stageKey,
            stageOrder: stageState.order,
            stageMap: stageState.map,
            totalAssets: totalAssetsTarget,
            processedAssets: assetsProcessed,
            recordsFetched,
            ohlcvRecordsFetched,
            errors: allErrors,
            message: errorMsg,
          });
        } else {
          this.currentProgress = {
            type: 'error',
            phase: 'fetch',
            stage: 'fundingFetch',
            stages: [],
            totalAssets: totalAssetsTarget,
            processedAssets: assetsProcessed,
            recordsFetched,
            errors: allErrors,
            percentage: 0,
            message: errorMsg,
          };
          this.emit('progress', this.currentProgress);
        }
      }

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
      const { assetsProcessed: processed, recordsCreated: created } =
        await FundingRateRepository.resampleHyperliquidTo8h();

      assetsProcessed = processed;
      recordsCreated = created;

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
    const lastFetch = await FetchLogRepository.getLastSuccessful(this.platform);

    return {
      platform: this.platform,
      assetCount,
      fundingRateCount,
      ohlcvCount,
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

