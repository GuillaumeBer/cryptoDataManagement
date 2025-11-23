/**
 * Shared types for the data fetching system
 */

export interface FundingHistoryRecord {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

export interface OHLCVRecord {
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

export interface OIRecord {
  asset: string;
  timestamp: Date;
  openInterest: string;
  openInterestValue?: string;
}

export interface LSRatioRecord {
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

export interface PlatformLiquidationRecord {
  asset: string;
  timestamp: Date;
  side: 'Long' | 'Short';
  price: number;
  quantity: number;
  volumeUsd: number;
  platform: string;
}

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
  | 'liquidationFetch'
  | 'liquidationStore'
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
  lsRatioRecordsFetched?: number;
  liquidationRecordsFetched?: number;
  resampleRecordsCreated?: number;
  resampleAssetsProcessed?: number;
  errors: string[];
  percentage: number;
  message?: string;
}

export const STAGE_LABELS: Record<FetchStage, string> = {
  assetDiscovery: 'Discover assets',
  fundingFetch: 'Fetch funding rates',
  fundingStore: 'Store funding rates',
  ohlcvFetch: 'Fetch OHLCV data',
  ohlcvStore: 'Store OHLCV data',
  oiFetch: 'Fetch open interest',
  oiStore: 'Store open interest',
  lsRatioFetch: 'Fetch L/S Ratios',
  lsRatioStore: 'Store L/S Ratios',
  liquidationFetch: 'Fetch liquidations',
  liquidationStore: 'Store liquidations',
  resample: 'Generate 8h aggregates',
};
