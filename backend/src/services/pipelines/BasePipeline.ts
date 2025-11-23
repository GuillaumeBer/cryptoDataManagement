import { FetchStage } from '../fetchTypes';
import { ProgressTracker } from '../ProgressTracker';
import { PlatformConfig } from '../PlatformConfig';
import { RateLimiter } from '../../utils/rateLimiter';
import { logger } from '../../utils/logger';

/**
 * Base class for all data fetch pipelines
 * Provides common functionality for progress tracking, error handling, and stage management
 */
export abstract class BasePipeline {
  constructor(
    protected readonly config: PlatformConfig,
    protected readonly progressTracker: ProgressTracker,
    protected readonly rateLimiter?: RateLimiter
  ) {}

  /**
   * Execute the pipeline
   * @returns Number of records fetched/stored
   */
  abstract execute(assets: string[]): Promise<number>;

  /**
   * Get the fetch stage key for this pipeline
   */
  abstract getFetchStage(): FetchStage;

  /**
   * Get the store stage key for this pipeline
   */
  abstract getStoreStage(): FetchStage;

  /**
   * Helper to start a fetch stage
   */
  protected startFetchStage(message: string = 'Fetching...'): void {
    const stage = this.getFetchStage();
    this.progressTracker.updateStage(stage, {
      status: 'active',
      message,
    });
    this.progressTracker.emitProgress('progress', stage, message);
  }

  /**
   * Helper to complete a fetch stage
   */
  protected completeFetchStage(): void {
    const stage = this.getFetchStage();
    this.progressTracker.updateStage(stage, { status: 'complete' });
    this.progressTracker.emitProgress('progress', stage, 'Fetch complete');
  }

  /**
   * Helper to start a store stage
   */
  protected startStoreStage(message: string = 'Storing...'): void {
    const stage = this.getStoreStage();
    this.progressTracker.updateStage(stage, {
      status: 'active',
      message,
    });
    this.progressTracker.emitProgress('progress', stage, message);
  }

  /**
   * Helper to complete a store stage
   */
  protected completeStoreStage(): void {
    const stage = this.getStoreStage();
    this.progressTracker.updateStage(stage, { status: 'complete' });
    this.progressTracker.emitProgress('progress', stage, 'Store complete');
  }

  /**
   * Helper to update fetch progress
   */
  protected updateFetchProgress(completed: number, currentItem?: string): void {
    const stage = this.getFetchStage();
    this.progressTracker.updateStage(stage, { completed, currentItem });
    this.progressTracker.emitProgress('progress', stage);
  }

  /**
   * Helper to update store progress
   */
  protected updateStoreProgress(completed: number, currentItem?: string): void {
    const stage = this.getStoreStage();
    this.progressTracker.updateStage(stage, { completed, currentItem });
    this.progressTracker.emitProgress('progress', stage);
  }

  /**
   * Helper to log and track errors
   */
  protected handleError(context: string, symbol: string, error: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const fullMessage = `${context} error for ${symbol}: ${errorMsg}`;
    logger.error(fullMessage);
    this.progressTracker.addError(fullMessage);
  }

  /**
   * Get concurrency limit for this pipeline
   */
  protected getConcurrency(): number {
    return this.config.getConcurrencyLimit();
  }

  /**
   * Check if pipeline should be skipped
   */
  protected shouldSkip(): boolean {
    return false; // Override in subclasses if needed
  }
}
