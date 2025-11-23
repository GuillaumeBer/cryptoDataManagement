import { EventEmitter } from 'events';
import {
  FetchStage,
  ProgressEvent,
  ProgressPhase,
  ProgressStageSnapshot,
  StageStatus,
  STAGE_LABELS,
} from './fetchTypes';

type StageStateMap = Map<FetchStage, ProgressStageSnapshot>;

/**
 * Manages progress tracking and event emission for data fetching operations
 */
export class ProgressTracker extends EventEmitter {
  private stageMap: StageStateMap = new Map();
  private stageOrder: FetchStage[] = [];
  private currentPhase: ProgressPhase = 'fetch';
  private totalAssets: number = 0;
  private processedAssets: number = 0;
  private recordsFetched: number = 0;
  private ohlcvRecordsFetched: number = 0;
  private oiRecordsFetched: number = 0;
  private lsRatioRecordsFetched: number = 0;
  private liquidationRecordsFetched: number = 0;
  private resampleRecordsCreated: number = 0;
  private resampleAssetsProcessed: number = 0;
  private errors: string[] = [];

  /**
   * Initialize the progress tracker with stages and totals
   */
  initialize(
    stageOrder: FetchStage[],
    stageTotals: Partial<Record<FetchStage, number>>,
    totalAssets: number
  ): void {
    this.stageOrder = stageOrder;
    this.stageMap = this.initializeStageMap(stageOrder, stageTotals);
    this.totalAssets = totalAssets;
    this.processedAssets = 0;
    this.recordsFetched = 0;
    this.ohlcvRecordsFetched = 0;
    this.oiRecordsFetched = 0;
    this.lsRatioRecordsFetched = 0;
    this.liquidationRecordsFetched = 0;
    this.resampleRecordsCreated = 0;
    this.resampleAssetsProcessed = 0;
    this.errors = [];
  }

  /**
   * Update a specific stage
   */
  updateStage(key: FetchStage, updates: Partial<ProgressStageSnapshot>): ProgressStageSnapshot {
    const current = this.stageMap.get(key);
    if (!current) {
      throw new Error(`Unknown progress stage: ${key}`);
    }

    const total = updates.total ?? current.total;
    const rawCompleted =
      typeof updates.completed === 'number' ? Math.max(0, updates.completed) : current.completed;
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
    this.stageMap.set(key, next);
    return next;
  }

  /**
   * Emit a progress event
   */
  emitProgress(
    type: 'start' | 'progress' | 'complete' | 'error',
    stage: FetchStage,
    message?: string
  ): void {
    const event: ProgressEvent = {
      type,
      phase: this.currentPhase,
      stage,
      stages: this.cloneStageSnapshots(),
      totalAssets: this.totalAssets,
      processedAssets: this.processedAssets,
      recordsFetched: this.recordsFetched,
      ohlcvRecordsFetched: this.ohlcvRecordsFetched,
      oiRecordsFetched: this.oiRecordsFetched,
      lsRatioRecordsFetched: this.lsRatioRecordsFetched,
      liquidationRecordsFetched: this.liquidationRecordsFetched,
      resampleRecordsCreated: this.resampleRecordsCreated,
      resampleAssetsProcessed: this.resampleAssetsProcessed,
      errors: [...this.errors],
      percentage: this.calculateOverallPercentage(),
      message,
    };

    this.emit('progress', event);
  }

  /**
   * Set the current phase
   */
  setPhase(phase: ProgressPhase): void {
    this.currentPhase = phase;
  }

  /**
   * Update counters
   */
  setProcessedAssets(count: number): void {
    this.processedAssets = count;
  }

  setRecordsFetched(count: number): void {
    this.recordsFetched = count;
  }

  setOHLCVRecordsFetched(count: number): void {
    this.ohlcvRecordsFetched = count;
  }

  setOIRecordsFetched(count: number): void {
    this.oiRecordsFetched = count;
  }

  setLSRatioRecordsFetched(count: number): void {
    this.lsRatioRecordsFetched = count;
  }

  setLiquidationRecordsFetched(count: number): void {
    this.liquidationRecordsFetched = count;
  }

  setResampleRecordsCreated(count: number): void {
    this.resampleRecordsCreated = count;
  }

  setResampleAssetsProcessed(count: number): void {
    this.resampleAssetsProcessed = count;
  }

  addError(error: string): void {
    this.errors.push(error);
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Get current progress snapshot
   */
  getCurrentProgress(): ProgressEvent {
    return {
      type: 'progress',
      phase: this.currentPhase,
      stage: this.stageOrder[0] || 'assetDiscovery',
      stages: this.cloneStageSnapshots(),
      totalAssets: this.totalAssets,
      processedAssets: this.processedAssets,
      recordsFetched: this.recordsFetched,
      ohlcvRecordsFetched: this.ohlcvRecordsFetched,
      oiRecordsFetched: this.oiRecordsFetched,
      lsRatioRecordsFetched: this.lsRatioRecordsFetched,
      liquidationRecordsFetched: this.liquidationRecordsFetched,
      resampleRecordsCreated: this.resampleRecordsCreated,
      resampleAssetsProcessed: this.resampleAssetsProcessed,
      errors: [...this.errors],
      percentage: this.calculateOverallPercentage(),
    };
  }

  /**
   * Private helper methods
   */
  private initializeStageMap(
    order: FetchStage[],
    totals: Partial<Record<FetchStage, number>>
  ): StageStateMap {
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
  }

  private cloneStageSnapshots(): ProgressStageSnapshot[] {
    return this.stageOrder
      .map((key) => {
        const snapshot = this.stageMap.get(key);
        return snapshot ? { ...snapshot } : undefined;
      })
      .filter((stage): stage is ProgressStageSnapshot => Boolean(stage));
  }

  private calculateOverallPercentage(): number {
    let weightedTotal = 0;
    let weightSum = 0;

    this.stageOrder.forEach((key) => {
      const stage = this.stageMap.get(key);
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
  }
}
