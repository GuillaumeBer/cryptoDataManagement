// Database model types
export interface Asset {
  id: number;
  symbol: string;
  platform: string;
  name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface FundingRate {
  id: number;
  asset_id: number;
  timestamp: Date;
  funding_rate: string;
  premium: string | null;
  platform: string;
  fetched_at: Date;
}

export interface FetchLog {
  id: number;
  platform: string;
  fetch_type: 'initial' | 'incremental';
  status: 'success' | 'failed' | 'partial';
  assets_processed: number;
  records_fetched: number;
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
}

// API Request/Response types
export interface CreateAssetParams {
  symbol: string;
  platform: string;
  name?: string;
}

export interface CreateFundingRateParams {
  asset_id: number;
  timestamp: Date;
  funding_rate: string;
  premium?: string;
  platform: string;
}

export interface FundingRateQuery {
  asset?: string;
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  limit?: number;
  offset?: number;
}

export interface FundingRateWithAsset extends FundingRate {
  asset_symbol: string;
  asset_name: string | null;
}

export interface AssetAnalytics {
  symbol: string;
  platform: string;
  total_records: number;
  avg_funding_rate: string;
  min_funding_rate: string;
  max_funding_rate: string;
  std_dev: string;
  first_timestamp: Date;
  last_timestamp: Date;
  positive_count: number;
  negative_count: number;
}
