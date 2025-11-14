// API Response types
export interface Asset {
  id: number;
  symbol: string;
  platform: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
