// API Response types
export interface Asset {
  id: number;
  symbol: string;
  platform: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  daysStale?: number; // Number of days since last funding rate update
}

export interface UnifiedAsset {
  id: number;
  normalized_symbol: string;
  display_name: string | null;
  description: string | null;
  coingecko_id: string | null;
  coingecko_name: string | null;
  coingecko_symbol: string | null;
  market_cap_usd: number | null;
  created_at: string;
  updated_at: string;
  platform_count: number;
  platforms: string[];
  avg_confidence: number;
  avg_correlation: number | string | null; // Can be string from database DECIMAL type
}

export interface FundingRate {
  id: number;
  asset_id: number;
  timestamp: string;
  funding_rate: string;
  premium: string | null;
  platform: string;
  fetched_at: string;
  asset_symbol: string;
  asset_name: string | null;
}

export interface OHLCVRecord {
  id: number;
  asset_id: number;
  timestamp: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  quote_volume: number | null;
  trades_count: number | null;
  platform: string;
  fetched_at: string;
  asset_symbol: string;
  asset_name: string | null;
}

export type ProgressPhase = 'fetch' | 'resample';

export type FetchStage =
  | 'assetDiscovery'
  | 'fundingFetch'
  | 'fundingStore'
  | 'ohlcvFetch'
  | 'ohlcvStore'
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
  resampleRecordsCreated?: number;
  resampleAssetsProcessed?: number;
  errors: string[];
  percentage: number;
  message?: string;
}

export interface FetchInProgressState {
  isInitialFetchInProgress: boolean;
  isIncrementalFetchInProgress: boolean;
  currentProgress?: ProgressEvent;
}

export interface SchedulerPlatformResult {
  platform: string;
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  assetsProcessed?: number;
  recordsFetched?: number;
  error?: string;
}

export interface SchedulerRunSummary {
  state: 'success' | 'partial' | 'failed' | 'idle' | 'running';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  results: SchedulerPlatformResult[];
  error?: string;
}

export interface SchedulerStatus {
  cronExpression: string;
  isScheduled: boolean;
  isJobRunning: boolean;
  lastRun: SchedulerRunSummary | null;
}

export interface SystemStatus {
  platform: string;
  assetCount: number;
  fundingRateCount: number;
  lastFetch: {
    type: string;
    completedAt: string;
    recordsFetched: number;
    assetsProcessed: number;
  } | null;
  fetchInProgress?: FetchInProgressState;
  scheduler?: SchedulerStatus;
  recentErrors?: FetchLog[];
}

export interface FetchResult {
  assetsProcessed: number;
  recordsFetched: number;
  errors: string[];
}

export interface AssetAnalytics {
  symbol: string;
  platform: string;
  total_records: number;
  avg_funding_rate: string;
  min_funding_rate: string;
  max_funding_rate: string;
  std_dev: string;
  first_timestamp: string;
  last_timestamp: string;
  positive_count: number;
  negative_count: number;
}

export interface FetchLog {
  id: number;
  platform: string;
  fetch_type: string;
  status: string;
  assets_processed: number;
  records_fetched: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  count?: number;
}
