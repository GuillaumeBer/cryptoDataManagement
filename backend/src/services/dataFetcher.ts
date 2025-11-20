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
import LongShortRatioRepository from '../models/LongShortRatioRepository';
import FetchLogRepository from '../models/FetchLogRepository';
import { CreateFundingRateParams, CreateOHLCVParams, CreateOpenInterestParams, CreateLongShortRatioParams } from '../models/types';
import {
  normalizePlatformAsset,
  SupportedPlatform,
  PlatformAssetPayload,
  isSupportedPlatform,
} from './normalizers/platformAssetNormalizer';
import { logger, attachFetchLogTransport, detachFetchLogTransport } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';
import winston from 'winston';

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

interface LSRatioRecord {
  asset: string;
  timestamp: Date;
  longRatio: number;
  shortRatio: number;
  longAccount?: number;
  shortAccount?: number;
  platform: string;
  type: string;
  period: string;
}

// Union type for all platform clients
type PlatformClient = {
  getAssets(): Promise<PlatformAssetPayload[]>;
  getFundingHistoryBatch(
    symbols: string[],
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FundingHistoryRecord[]) => Promise<void>
  ): Promise<Map<string, FundingHistoryRecord[]>>;
  getOHLCVBatch(
    symbols: string[],
    interval?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: OHLCVRecord[]) => Promise<void>
  ): Promise<Map<string, OHLCVRecord[]>>;
  getOpenInterestBatch(
    symbols: string[],
    period?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: OIRecord[]) => Promise<void>
  ): Promise<Map<string, OIRecord[]>>;
  getLongShortRatioBatch?(
    symbols: string[],
    period?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: LSRatioRecord[]) => Promise<void>
  ): Promise<Map<string, LSRatioRecord[]>>;
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
  | 'lsRatioFetch'
  | 'lsRatioStore'
  | 'resample';

/**
 * Platforms that only support OI snapshots (not historical data)
 * These platforms should NOT auto-fetch OI data during regular fetches
 */
const SNAPSHOT_ONLY_OI_PLATFORMS = ['hyperliquid', 'aster'] as const;

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
  lsRatioRecordsFetched?: number;
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
  lsRatioFetch: 'Fetch L/S Ratios',
  lsRatioStore: 'Store L/S Ratios',
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

// Original stage order (sequential)
const INITIAL_STAGE_ORDER: FetchStage[] = [
  'assetDiscovery',
  'fundingFetch',
  'fundingStore',
  'ohlcvFetch',
  'ohlcvStore',
  'oiFetch',
  'oiStore',
  'lsRatioFetch',
  'lsRatioStore',
];

const INCREMENTAL_STAGE_ORDER: FetchStage[] = [
  'fundingFetch',
  'fundingStore',
  'ohlcvFetch',
  'ohlcvStore',
  'oiFetch',
  'oiStore',
  'lsRatioFetch',
  'lsRatioStore',
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
  lsRatioRecordsFetched?: number;
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
  private rateLimiter: RateLimiter | undefined;

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
   * - OKX: "1H" (uppercase, but fetches daily data via 1D period)
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
        return '1H'; // OKX uses uppercase (but client fetches 1D data internally)
      case 'dydx':
        return '1HOUR'; // DyDx uses full word
      case 'hyperliquid':
        return '1h'; // Not used (snapshot only), but provide default
      default:
        return '1h';
    }
  }

  /**
   * Get the timeframe to store in the database for Open Interest data
   * This indicates the granularity of the data being stored:
   * - Most platforms: '1h' (hourly data)
   * - OKX: '1d' (daily data, as we fetch 30 days using 1D period)
   */
  private getOITimeframe(): string {
    switch (this.platform) {
      case 'okx':
        return '1d'; // OKX stores daily OI data
      default:
        return '1h'; // Most platforms store hourly OI data
    }
  }

  /**
   * Get the L/S Ratio interval/period for each platform
   */
  private getLSRatioInterval(): string {
    switch (this.platform) {
      case 'binance':
        return '5m'; // We want high granularity if possible, or '1h'
      case 'bybit':
        return '5min'; // Bybit supports 5min, 15min, 30min, 1h, 4h, 1d
      case 'okx':
        return '1H'; // OKX supports 5m, 1H, 4H, 1D
      default:
        return '1h';
    }
  }

  /**
   * Get Rate Limiter configuration for the platform
   */
  private getRateLimiterConfig(): { capacity: number; interval: number } {
    switch (this.platform) {
      case 'hyperliquid':
        // 1200 weight per minute
        return { capacity: 1200, interval: 60000 };
      case 'binance':
        // 2400 weight per minute (conservative default)
        return { capacity: 2400, interval: 60000 };
      case 'bybit':
        // 120 requests per second = 7200 per minute
        return { capacity: 7200, interval: 60000 };
      case 'okx':
        // 20 requests per 2 seconds = 600 per minute
        return { capacity: 600, interval: 60000 };
      case 'dydx':
        // Conservative
        return { capacity: 600, interval: 60000 };
      case 'aster':
        // Very conservative due to strict rate limiting
        return { capacity: 600, interval: 60000 };
      default:
        return { capacity: 600, interval: 60000 };
    }
  }

  /**
   * Get the optimal rate limit delay for each platform (Legacy, used if RateLimiter not available)
   */
  // @ts-ignore - kept for legacy/fallback but currently unused with RateLimiter
  private getRateLimitDelay(): number {
    const baseDelay = (() => {
      switch (this.platform) {
        case 'hyperliquid':
          return 0; // Controlled by RateLimiter
        case 'binance':
          return 0;
        case 'bybit':
        case 'okx':
          return 0;
        case 'dydx':
          return 100;
        case 'aster':
          return 100;
        default:
          return 500;
      }
    })();

    // Use 0 if using RateLimiter, but keep logic just in case
    if (this.rateLimiter) return 0;

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

    // With centralized RateLimiter, we can increase concurrency significantly
    switch (this.platform) {
      case 'hyperliquid':
        return 5;
      case 'binance':
        return 1;
      case 'bybit':
        return 10;
      case 'okx':
        return 2;
      case 'dydx':
        return 1;
      case 'aster':
        return 2;
      default:
        return 1;
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

    // Initialize Rate Limiter
    const { capacity, interval } = this.getRateLimiterConfig();
    this.rateLimiter = new RateLimiter(capacity, interval);
    logger.info(`RateLimiter initialized for ${this.platform}: ${capacity} tokens per ${interval}ms`);

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
    lsRatioRecordsFetched?: number;
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
          lsRatioRecordsFetched: context.lsRatioRecordsFetched,
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
          oiRecordsFetched: context.oiRecordsFetched,
          lsRatioRecordsFetched: context.lsRatioRecordsFetched,
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
      oiRecordsFetched: context.oiRecordsFetched,
      lsRatioRecordsFetched: context.lsRatioRecordsFetched,
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
        oiRecordsFetched: context.oiRecordsFetched,
        lsRatioRecordsFetched: context.lsRatioRecordsFetched,
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
        oiRecordsFetched: context.oiRecordsFetched,
        lsRatioRecordsFetched: context.lsRatioRecordsFetched,
        errors: context.errors,
        message: 'Resampling failed',
      });
      throw error;
    }
  }

  /**
   * Initial fetch: Get all assets and their full funding history (last 480 hours)
   * Parallelized version
   */
  async fetchInitialData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    ohlcvRecordsFetched: number;
    oiRecordsFetched: number;
    lsRatioRecordsFetched: number;
    errors: string[];
  }> {
    if (this.isInitialFetchInProgress) throw new Error('Initial fetch is already in progress');
    if (this.isIncrementalFetchInProgress) throw new Error('Incremental fetch is in progress');

    this.isInitialFetchInProgress = true;
    logger.info(`Starting parallel initial data fetch from ${this.platform}`);

    // Attach fetch-specific log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilename = `logs/fetch-${this.platform}-${timestamp}-initial.log`;
    let transport: winston.transport | null = null;

    try {
      transport = attachFetchLogTransport(logFilename);
      logger.info(`Logging fetch warnings/errors to ${logFilename}`);
    } catch (error) {
      logger.error('Failed to attach fetch log transport', error);
    }

    const fetchLog = await FetchLogRepository.create(this.platform, 'initial');

    // Tracking variables
    let assetsProcessed = 0; // Tracked differently in parallel, maybe redundant
    let recordsFetched = 0;
    let ohlcvRecordsFetched = 0;
    let oiRecordsFetched = 0;
    let lsRatioRecordsFetched = 0;
    const errors: string[] = [];

    try {
      // 1. Fetch and Store Assets (Must be done first)
      const assets = await this.platformClient.getAssets();
      const normalizedAssets = assets.flatMap((asset: PlatformAssetPayload) => {
        const normalized = normalizePlatformAsset(this.platform, asset);
        return normalized ? [normalized] : [];
      });

      const uniqueAssets = Array.from(
        new Map(normalizedAssets.map((asset) => [asset.symbol, asset])).values()
      );

      await AssetRepository.bulkUpsert(uniqueAssets);
      await AssetRepository.deactivateMissingSymbols(this.platform, uniqueAssets.map((asset) => asset.symbol));

      // 2. Prepare for Parallel Fetch
      const storedAssets = await AssetRepository.findByPlatform(this.platform);
      const assetMap = new Map(storedAssets.map((asset) => [asset.symbol, asset.id]));
      const assetSymbols = storedAssets.map(a => a.symbol);

      // Initialize Progress Map
      const stageOrder = this.platform === 'hyperliquid'
        ? ([...INITIAL_STAGE_ORDER, 'resample'] as FetchStage[])
        : (INITIAL_STAGE_ORDER as FetchStage[]);

      const stageTotals: Partial<Record<FetchStage, number>> = {
        assetDiscovery: uniqueAssets.length,
        fundingFetch: assetSymbols.length,
        fundingStore: assetSymbols.length,
        ohlcvFetch: assetSymbols.length,
        ohlcvStore: assetSymbols.length,
        oiFetch: assetSymbols.length,
        oiStore: assetSymbols.length,
        lsRatioFetch: assetSymbols.length,
        lsRatioStore: assetSymbols.length,
      };
      if (this.platform === 'hyperliquid') stageTotals.resample = assetSymbols.length;

      const stageMap = initializeStageMap(stageOrder, stageTotals);
      const stageState = { order: stageOrder, map: stageMap };

      updateStage(stageMap, 'assetDiscovery', { status: 'complete', completed: uniqueAssets.length });

      // Helper to emit progress
      const emitProgress = (message?: string) => {
        this.emitStageProgress({
          stageKey: 'fundingFetch', // Default key, overridden by specific updates
          stageOrder,
          stageMap,
          totalAssets: assetSymbols.length,
          processedAssets: assetsProcessed, // This is approximate now
          recordsFetched,
          ohlcvRecordsFetched,
          oiRecordsFetched,
          lsRatioRecordsFetched,
          errors,
          message,
        });
      };

      // --- Parallel Pipelines ---

      // A. Funding Rate Pipeline
      const fundingPipeline = async () => {
        updateStage(stageMap, 'fundingFetch', { status: 'active', message: 'Fetching funding rates...' });
        updateStage(stageMap, 'fundingStore', { status: 'active', message: 'Storing funding rates...' });

        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getFundingHistoryBatch(
          assetSymbols,
          0, // Delay controlled by RateLimiter
          this.getConcurrencyLimit(),
          (symbol, processed) => {
            fetchedCount = processed;
            updateStage(stageMap, 'fundingFetch', { completed: fetchedCount, currentItem: symbol });
            emitProgress('Fetching funding rates...');
          },
          this.rateLimiter,
          // On Item Fetched: Store immediately
          async (symbol, data) => {
            // @ts-ignore
            void symbol; // fix unused var
            try {
              const assetId = assetMap.get(symbol);
              if (!assetId) return;

              const records: CreateFundingRateParams[] = data.map((fd) => ({
                asset_id: assetId,
                timestamp: fd.timestamp,
                funding_rate: fd.fundingRate,
                premium: fd.premium,
                platform: this.platform,
                sampling_interval: this.getSamplingInterval(),
              }));

              if (records.length > 0) {
                const inserted = await FundingRateRepository.bulkInsert(records);
                recordsFetched += inserted;
              }

              storedCount++;
              updateStage(stageMap, 'fundingStore', { completed: storedCount, currentItem: symbol });
              emitProgress('Storing funding rates...');
            } catch (err) {
              errors.push(`Funding store error ${symbol}: ${err}`);
            }
          }
        );

        updateStage(stageMap, 'fundingFetch', { status: 'complete' });
        updateStage(stageMap, 'fundingStore', { status: 'complete' });
      };

      // B. OHLCV Pipeline
      const ohlcvPipeline = async () => {
        updateStage(stageMap, 'ohlcvFetch', { status: 'active', message: 'Fetching OHLCV...' });
        updateStage(stageMap, 'ohlcvStore', { status: 'active', message: 'Storing OHLCV...' });

        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getOHLCVBatch(
          assetSymbols,
          this.getOHLCVInterval(),
          0,
          this.getConcurrencyLimit(),
          (symbol, processed) => {
            fetchedCount = processed;
            updateStage(stageMap, 'ohlcvFetch', { completed: fetchedCount, currentItem: symbol });
            emitProgress('Fetching OHLCV...');
          },
          this.rateLimiter,
          async (symbol, data) => {
            // @ts-ignore
             void symbol;
            try {
              const assetId = assetMap.get(symbol);
              if (!assetId) return;

              const records: CreateOHLCVParams[] = data.map((d) => ({
                asset_id: assetId,
                timestamp: d.timestamp,
                timeframe: '1h',
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
                quote_volume: d.quoteVolume,
                trades_count: d.tradesCount,
                platform: this.platform,
              }));

              if (records.length > 0) {
                const inserted = await OHLCVRepository.bulkInsert(records);
                ohlcvRecordsFetched += inserted;
              }

              storedCount++;
              updateStage(stageMap, 'ohlcvStore', { completed: storedCount, currentItem: symbol });
              emitProgress('Storing OHLCV...');
            } catch (err) {
               errors.push(`OHLCV store error ${symbol}: ${err}`);
            }
          }
        );

        updateStage(stageMap, 'ohlcvFetch', { status: 'complete' });
        updateStage(stageMap, 'ohlcvStore', { status: 'complete' });
      };

      // C. Open Interest Pipeline
      const oiPipeline = async () => {
        if (SNAPSHOT_ONLY_OI_PLATFORMS.includes(this.platform as any)) {
           updateStage(stageMap, 'oiFetch', { status: 'complete', message: 'Skipped' });
           updateStage(stageMap, 'oiStore', { status: 'complete', message: 'Skipped' });
           return;
        }

        updateStage(stageMap, 'oiFetch', { status: 'active', message: 'Fetching OI...' });
        updateStage(stageMap, 'oiStore', { status: 'active', message: 'Storing OI...' });

        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getOpenInterestBatch(
          assetSymbols,
          this.getOIInterval(),
          0,
          this.getConcurrencyLimit(),
          (symbol, processed) => {
            fetchedCount = processed;
            updateStage(stageMap, 'oiFetch', { completed: fetchedCount, currentItem: symbol });
            emitProgress('Fetching OI...');
          },
          this.rateLimiter,
          async (symbol, data) => {
            // @ts-ignore
            void symbol; // fix unused var
            try {
              const assetId = assetMap.get(symbol);
              if (!assetId) return;

              const records: CreateOpenInterestParams[] = data.map((d) => ({
                asset_id: assetId,
                timestamp: d.timestamp,
                timeframe: this.getOITimeframe(),
                open_interest: d.openInterest,
                open_interest_value: d.openInterestValue,
                platform: this.platform,
              }));

              if (records.length > 0) {
                const inserted = await OpenInterestRepository.bulkInsert(records);
                oiRecordsFetched += inserted;
              }

              storedCount++;
              updateStage(stageMap, 'oiStore', { completed: storedCount, currentItem: symbol });
              emitProgress('Storing OI...');
            } catch (err) {
              errors.push(`OI store error ${symbol}: ${err}`);
            }
          }
        );

        updateStage(stageMap, 'oiFetch', { status: 'complete' });
        updateStage(stageMap, 'oiStore', { status: 'complete' });
      };

      // D. Long/Short Ratio Pipeline
      const lsRatioPipeline = async () => {
        if (!this.platformClient.getLongShortRatioBatch) {
          updateStage(stageMap, 'lsRatioFetch', { status: 'complete', message: 'Not supported' });
          updateStage(stageMap, 'lsRatioStore', { status: 'complete', message: 'Not supported' });
          return;
        }

        updateStage(stageMap, 'lsRatioFetch', { status: 'active', message: 'Fetching L/S Ratios...' });
        updateStage(stageMap, 'lsRatioStore', { status: 'active', message: 'Storing L/S Ratios...' });

        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getLongShortRatioBatch(
          assetSymbols,
          this.getLSRatioInterval(),
          0,
          this.getConcurrencyLimit(),
          (symbol, processed) => {
            fetchedCount = processed;
            updateStage(stageMap, 'lsRatioFetch', { completed: fetchedCount, currentItem: symbol });
            emitProgress('Fetching L/S Ratios...');
          },
          this.rateLimiter,
          async (symbol, data) => {
            try {
              const assetId = assetMap.get(symbol);
              if (!assetId) return;

              const records: CreateLongShortRatioParams[] = data.map((d) => ({
                asset_id: assetId,
                timestamp: d.timestamp,
                long_ratio: d.longRatio,
                short_ratio: d.shortRatio,
                long_account: d.longAccount,
                short_account: d.shortAccount,
                platform: this.platform,
                type: d.type,
                period: d.period,
              }));

              if (records.length > 0) {
                const inserted = await LongShortRatioRepository.bulkUpsert(records);
                lsRatioRecordsFetched += inserted;
              }

              storedCount++;
              updateStage(stageMap, 'lsRatioStore', { completed: storedCount, currentItem: symbol });
              emitProgress('Storing L/S Ratios...');
            } catch (err) {
              errors.push(`L/S Ratio store error ${symbol}: ${err}`);
            }
          }
        );

        updateStage(stageMap, 'lsRatioFetch', { status: 'complete' });
        updateStage(stageMap, 'lsRatioStore', { status: 'complete' });
      };

      // Execute all pipelines in parallel
      await Promise.all([fundingPipeline(), ohlcvPipeline(), oiPipeline(), lsRatioPipeline()]);

      // Calculate total processed (approximate as max of any stage)
      assetsProcessed = assetSymbols.length;

      // Update Logs
      const status = errors.length === 0 ? 'success' : errors.length < assetSymbols.length ? 'partial' : 'failed';
      await FetchLogRepository.complete(fetchLog.id, status, assetsProcessed, recordsFetched, errors.join('; '));

      await this.finalizeFetchProgress({
        totalAssets: assetSymbols.length,
        assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        oiRecordsFetched,
        lsRatioRecordsFetched,
        errors,
        stageState
      });

      return { assetsProcessed, recordsFetched, ohlcvRecordsFetched, oiRecordsFetched, lsRatioRecordsFetched, errors };

    } catch (error) {
       const errorMsg = error instanceof Error ? error.message : String(error);
       logger.error('Initial data fetch failed:', errorMsg);
       await FetchLogRepository.complete(fetchLog.id, 'failed', assetsProcessed, recordsFetched, errorMsg);
       throw error;
    } finally {
      // Detach log transport
      if (transport) {
        detachFetchLogTransport(transport);
      }
      // Always clear the in-progress flag and current progress
      this.isInitialFetchInProgress = false;
      this.currentProgress = null;
    }
  }

  /**
   * Incremental fetch: Parallelized
   */
  async fetchIncrementalData(): Promise<{
    assetsProcessed: number;
    recordsFetched: number;
    ohlcvRecordsFetched: number;
    oiRecordsFetched: number;
    lsRatioRecordsFetched: number;
    errors: string[];
  }> {
    if (this.isIncrementalFetchInProgress) throw new Error('Incremental fetch is already in progress');
    if (this.isInitialFetchInProgress) throw new Error('Initial fetch is in progress');

    this.isIncrementalFetchInProgress = true;
    logger.info(`Starting parallel incremental fetch from ${this.platform}`);

    // Attach fetch-specific log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilename = `logs/fetch-${this.platform}-${timestamp}-incremental.log`;
    let transport: winston.transport | null = null;

    try {
      transport = attachFetchLogTransport(logFilename);
      logger.info(`Logging fetch warnings/errors to ${logFilename}`);
    } catch (error) {
      logger.error('Failed to attach fetch log transport', error);
    }

    const fetchLog = await FetchLogRepository.create(this.platform, 'incremental');

    let assetsProcessed = 0;
    let recordsFetched = 0;
    let ohlcvRecordsFetched = 0;
    let oiRecordsFetched = 0;
    let lsRatioRecordsFetched = 0;
    const errors: string[] = [];

    try {
      const assets = await AssetRepository.findByPlatform(this.platform);
      if (assets.length === 0) {
         await FetchLogRepository.complete(fetchLog.id, 'failed', 0, 0, 'No assets found');
         return { assetsProcessed: 0, recordsFetched: 0, ohlcvRecordsFetched: 0, oiRecordsFetched: 0, lsRatioRecordsFetched: 0, errors: ['No assets'] };
      }

      const assetSymbols = assets.map(a => a.symbol);
      const assetMap = new Map(assets.map(a => [a.symbol, a.id]));

      // Pre-fetch latest timestamps to minimize DB lookups inside loops
      const latestFundingTimestamps = await FundingRateRepository.getLatestTimestamps(assets.map(a => a.id), this.platform, this.getSamplingInterval());
      const latestOHLCVTimestamps = await OHLCVRepository.getLatestTimestamps(assets.map(a => a.id), this.platform, '1h');
      // For L/S Ratio, we need latest timestamps too. Assuming we use '5m' or '1h' as default period for now.
      // We'll use getLatestTimestamp inside the loop or fetch batch if repo supports it.
      // For now, let's just fetch latest inside the loop or rely on upsert.
      // Optimization: Add getLatestTimestamps to LongShortRatioRepository later.

      const stageOrder = this.platform === 'hyperliquid'
        ? ([...INCREMENTAL_STAGE_ORDER, 'resample'] as FetchStage[])
        : (INCREMENTAL_STAGE_ORDER as FetchStage[]);

      const stageTotals: Partial<Record<FetchStage, number>> = {
        fundingFetch: assets.length,
        fundingStore: assets.length,
        ohlcvFetch: assets.length,
        ohlcvStore: assets.length,
        oiFetch: assets.length,
        oiStore: assets.length,
        lsRatioFetch: assets.length,
        lsRatioStore: assets.length,
      };
      if (this.platform === 'hyperliquid') stageTotals.resample = assets.length;

      const stageMap = initializeStageMap(stageOrder, stageTotals);
      const stageState = { order: stageOrder, map: stageMap };

      const emitProgress = (message?: string) => {
        this.emitStageProgress({
          stageKey: 'fundingFetch',
          stageOrder,
          stageMap,
          totalAssets: assets.length,
          processedAssets: assetsProcessed,
          recordsFetched,
          ohlcvRecordsFetched,
          oiRecordsFetched,
          lsRatioRecordsFetched,
          errors,
          message,
        });
      };

      // A. Funding Pipeline
      const fundingPipeline = async () => {
        updateStage(stageMap, 'fundingFetch', { status: 'active', message: 'Fetching funding updates...' });
        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getFundingHistoryBatch(
          assetSymbols,
          0,
          this.getConcurrencyLimit(),
          (_symbol, processed) => {
             fetchedCount = processed;
             updateStage(stageMap, 'fundingFetch', { completed: fetchedCount });
             emitProgress();
          },
          this.rateLimiter,
          async (symbol, data) => {
             // @ts-ignore
             void symbol;
             try {
               const assetId = assetMap.get(symbol);
               if (!assetId) return;

               const latest = latestFundingTimestamps.get(assetId);
               const newRecords = latest ? data.filter(d => d.timestamp > latest) : data;

               if (newRecords.length > 0) {
                 const records = newRecords.map(fd => ({
                    asset_id: assetId,
                    timestamp: fd.timestamp,
                    funding_rate: fd.fundingRate,
                    premium: fd.premium,
                    platform: this.platform,
                    sampling_interval: this.getSamplingInterval(),
                 }));
                 const inserted = await FundingRateRepository.bulkInsert(records);
                 recordsFetched += inserted;
               }
               storedCount++;
               updateStage(stageMap, 'fundingStore', { completed: storedCount });
               emitProgress();
             } catch (err) {
               errors.push(`Funding update error ${symbol}: ${err}`);
             }
          }
        );
        updateStage(stageMap, 'fundingFetch', { status: 'complete' });
        updateStage(stageMap, 'fundingStore', { status: 'complete' });
      };

      // B. OHLCV Pipeline
      const ohlcvPipeline = async () => {
        updateStage(stageMap, 'ohlcvFetch', { status: 'active', message: 'Fetching OHLCV updates...' });
        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getOHLCVBatch(
          assetSymbols,
          this.getOHLCVInterval(),
          0,
          this.getConcurrencyLimit(),
          (_symbol, processed) => {
             fetchedCount = processed;
             updateStage(stageMap, 'ohlcvFetch', { completed: fetchedCount });
             emitProgress();
          },
          this.rateLimiter,
          async (symbol, data) => {
             // @ts-ignore
             void symbol;
             try {
               const assetId = assetMap.get(symbol);
               if (!assetId) return;

               const latest = latestOHLCVTimestamps.get(assetId);
               const newRecords = latest ? data.filter(d => d.timestamp > latest) : data;

               if (newRecords.length > 0) {
                 const records = newRecords.map(d => ({
                    asset_id: assetId,
                    timestamp: d.timestamp,
                    timeframe: '1h',
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
                 ohlcvRecordsFetched += inserted;
               }
               storedCount++;
               updateStage(stageMap, 'ohlcvStore', { completed: storedCount });
               emitProgress();
             } catch (err) {
               errors.push(`OHLCV update error ${symbol}: ${err}`);
             }
          }
        );
        updateStage(stageMap, 'ohlcvFetch', { status: 'complete' });
        updateStage(stageMap, 'ohlcvStore', { status: 'complete' });
      };

      // C. OI Pipeline (Always mostly "new" / snapshot)
      const oiPipeline = async () => {
        if (SNAPSHOT_ONLY_OI_PLATFORMS.includes(this.platform as any)) {
           updateStage(stageMap, 'oiFetch', { status: 'complete' });
           updateStage(stageMap, 'oiStore', { status: 'complete' });
           return;
        }
        updateStage(stageMap, 'oiFetch', { status: 'active', message: 'Fetching OI updates...' });
        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getOpenInterestBatch(
          assetSymbols,
          this.getOIInterval(),
          0,
          this.getConcurrencyLimit(),
          (_symbol, processed) => {
             fetchedCount = processed;
             updateStage(stageMap, 'oiFetch', { completed: fetchedCount });
             emitProgress();
          },
          this.rateLimiter,
          async (symbol, data) => {
             // @ts-ignore
             void symbol;
             try {
               const assetId = assetMap.get(symbol);
               if (!assetId) return;

               // Store all fetched OI data (assuming deduplication happens in repo or is acceptable)
               const records = data.map(d => ({
                  asset_id: assetId,
                  timestamp: d.timestamp,
                  timeframe: this.getOITimeframe(),
                  open_interest: d.openInterest,
                  open_interest_value: d.openInterestValue,
                  platform: this.platform,
               }));

               if (records.length > 0) {
                 const inserted = await OpenInterestRepository.bulkInsert(records);
                 oiRecordsFetched += inserted;
               }
               storedCount++;
               updateStage(stageMap, 'oiStore', { completed: storedCount });
               emitProgress();
             } catch (err) {
               errors.push(`OI update error ${symbol}: ${err}`);
             }
          }
        );
        updateStage(stageMap, 'oiFetch', { status: 'complete' });
        updateStage(stageMap, 'oiStore', { status: 'complete' });
      };

      // D. L/S Ratio Pipeline
      const lsRatioPipeline = async () => {
        if (!this.platformClient.getLongShortRatioBatch) {
          updateStage(stageMap, 'lsRatioFetch', { status: 'complete', message: 'Not supported' });
          updateStage(stageMap, 'lsRatioStore', { status: 'complete', message: 'Not supported' });
          return;
        }

        updateStage(stageMap, 'lsRatioFetch', { status: 'active', message: 'Fetching L/S Ratio updates...' });
        let fetchedCount = 0;
        let storedCount = 0;

        await this.platformClient.getLongShortRatioBatch(
          assetSymbols,
          this.getLSRatioInterval(),
          0,
          this.getConcurrencyLimit(),
          (_symbol, processed) => {
             fetchedCount = processed;
             updateStage(stageMap, 'lsRatioFetch', { completed: fetchedCount });
             emitProgress();
          },
          this.rateLimiter,
          async (symbol, data) => {
             try {
               const assetId = assetMap.get(symbol);
               if (!assetId) return;

               // For incremental, we could filter by timestamp if we had latest timestamps fetched.
               // Since we didn't fetch latest timestamps for L/S yet, we'll rely on bulkUpsert to handle duplicates safely.
               // Or we can fetch latest timestamp here (slower).
               // Given it's incremental, we probably only get recent data anyway.
               
               const records: CreateLongShortRatioParams[] = data.map((d) => ({
                 asset_id: assetId,
                 timestamp: d.timestamp,
                 long_ratio: d.longRatio,
                 short_ratio: d.shortRatio,
                 long_account: d.longAccount,
                 short_account: d.shortAccount,
                 platform: this.platform,
                 type: d.type,
                 period: d.period,
               }));

               if (records.length > 0) {
                 const inserted = await LongShortRatioRepository.bulkUpsert(records);
                 lsRatioRecordsFetched += inserted;
               }
               storedCount++;
               updateStage(stageMap, 'lsRatioStore', { completed: storedCount });
               emitProgress();
             } catch (err) {
               errors.push(`L/S Ratio update error ${symbol}: ${err}`);
             }
          }
        );
        updateStage(stageMap, 'lsRatioFetch', { status: 'complete' });
        updateStage(stageMap, 'lsRatioStore', { status: 'complete' });
      };

      await Promise.all([fundingPipeline(), ohlcvPipeline(), oiPipeline(), lsRatioPipeline()]);

      assetsProcessed = assets.length;
      const status = errors.length === 0 ? 'success' : 'partial';
      await FetchLogRepository.complete(fetchLog.id, status, assetsProcessed, recordsFetched, errors.join('; '));

      await this.finalizeFetchProgress({
        totalAssets: assets.length,
        assetsProcessed,
        recordsFetched,
        ohlcvRecordsFetched,
        oiRecordsFetched,
        lsRatioRecordsFetched,
        errors,
        stageState
      });

      return { assetsProcessed, recordsFetched, ohlcvRecordsFetched, oiRecordsFetched, lsRatioRecordsFetched, errors };

    } catch (error) {
       const errorMsg = error instanceof Error ? error.message : String(error);
       logger.error('Incremental data fetch failed:', errorMsg);
       await FetchLogRepository.complete(fetchLog.id, 'failed', assetsProcessed, recordsFetched, errorMsg);
       throw error;
    } finally {
      // Detach log transport
      if (transport) {
        detachFetchLogTransport(transport);
      }
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
    const lsRatioCount = await LongShortRatioRepository.count(this.platform); // Assuming count method exists or we add it
    const lastFetch = await FetchLogRepository.getLastSuccessful(this.platform);

    return {
      platform: this.platform,
      assetCount,
      fundingRateCount,
      ohlcvCount,
      lsRatioCount,
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
      rateLimiter: this.rateLimiter ? this.rateLimiter.getStats() : null
    };
  }
}
