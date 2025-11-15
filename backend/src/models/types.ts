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
  sampling_interval: string; // '1h', '8h', etc.
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
  sampling_interval?: string; // Defaults to '1h' if not specified
}

export interface FundingRateQuery {
  asset?: string;
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  sampling_interval?: string; // Filter by sampling interval ('1h', '8h', etc.)
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

// Unified Assets types
export interface UnifiedAsset {
  id: number;
  normalized_symbol: string;
  display_name: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AssetMapping {
  id: number;
  unified_asset_id: number;
  asset_id: number;
  confidence_score: number;
  mapping_method: 'auto_symbol' | 'auto_price' | 'manual';
  price_used: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUnifiedAssetParams {
  normalized_symbol: string;
  display_name?: string;
  description?: string;
}

export interface CreateAssetMappingParams {
  unified_asset_id: number;
  asset_id: number;
  confidence_score?: number;
  mapping_method: 'auto_symbol' | 'auto_price' | 'manual';
  price_used?: string;
}

export interface UnifiedAssetWithMappings extends UnifiedAsset {
  mappings: Array<AssetMapping & {
    asset_symbol: string;
    asset_platform: string;
  }>;
}
