import { FetchStage } from '../fetchTypes';
import { ProgressTracker } from '../ProgressTracker';
import { PlatformConfig } from '../PlatformConfig';
import { PlatformClient } from '../PlatformClient';
import { SupportedPlatform } from '../normalizers/platformAssetNormalizer';
import { RateLimiter } from '../../utils/rateLimiter';

/**
 * Result of a fetch strategy execution
 */
export interface FetchResult {
  assetsProcessed: number;
  recordsFetched: number;
  ohlcvRecordsFetched: number;
  oiRecordsFetched: number;
  lsRatioRecordsFetched: number;
  liquidationRecordsFetched: number;
  errors: string[];
}

/**
 * Base class for fetch strategies
 * Defines the common interface and workflow for Initial and Incremental fetches
 */
export abstract class FetchStrategy {
  constructor(
    protected readonly config: PlatformConfig,
    protected readonly progressTracker: ProgressTracker,
    protected readonly platformClient: PlatformClient,
    protected readonly platform: SupportedPlatform,
    protected readonly rateLimiter?: RateLimiter
  ) {}

  /**
   * Execute the fetch strategy
   * @returns FetchResult with counts and errors
   */
  abstract execute(): Promise<FetchResult>;

  /**
   * Get the stage order for this strategy
   */
  protected abstract getStageOrder(): FetchStage[];

  /**
   * Estimate stage totals for progress tracking
   */
  protected abstract estimateStageTotals(assetCount: number): Partial<Record<FetchStage, number>>;

  /**
   * Get assets for the fetch
   */
  protected abstract getAssets(): Promise<string[]>;

  /**
   * Whether to include resampling (Hyperliquid only)
   */
  protected shouldResample(): boolean {
    return this.platform === 'hyperliquid';
  }
}
