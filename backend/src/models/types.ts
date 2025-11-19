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

export interface OHLCVData {
  id: number;
  asset_id: number;
  timestamp: Date;
  timeframe: string; // '1m', '5m', '15m', '1h', '4h', '1d', etc.
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  quote_volume: string | null;
  trades_count: number | null;
  platform: string;
  fetched_at: Date;
}

export interface CreateOHLCVParams {
  asset_id: number;
  timestamp: Date;
  timeframe: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
  quote_volume?: string;
  trades_count?: number;
  platform: string;
}

export interface OHLCVQuery {
  asset?: string;
  assetId?: number; // Query by asset ID directly
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  timeframe?: string; // Filter by timeframe ('1m', '1h', '1d', etc.)
  limit?: number;
  offset?: number;
}

export interface OHLCVDataWithAsset extends OHLCVData {
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
  coingecko_id: string | null;
  coingecko_name: string | null;
  coingecko_symbol: string | null;
  market_cap_usd: number | null;
  market_cap_rank: number | null;
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
  price_correlation: string | null;
  last_validated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUnifiedAssetParams {
  normalized_symbol: string;
  display_name?: string;
  description?: string;
  coingecko_id?: string;
  coingecko_name?: string;
  coingecko_symbol?: string;
  market_cap_usd?: number | null;
  market_cap_rank?: number | null;
}

export interface CreateAssetMappingParams {
  unified_asset_id: number;
  asset_id: number;
  confidence_score?: number;
  mapping_method: 'auto_symbol' | 'auto_price' | 'manual';
  price_used?: string;
  price_correlation?: number;
  last_validated_at?: Date;
}

export interface UnifiedAssetWithMappings extends UnifiedAsset {
  mappings: Array<AssetMapping & {
    asset_symbol: string;
    asset_platform: string;
  }>;
}

// Open Interest types
export interface OpenInterest {
  id: number;
  asset_id: number;
  timestamp: Date;
  timeframe: string; // '1h', '4h', '1d', etc.
  open_interest: string;
  open_interest_value: string | null;
  platform: string;
  fetched_at: Date;
}

export interface CreateOpenInterestParams {
  asset_id: number;
  timestamp: Date;
  timeframe: string;
  open_interest: string;
  open_interest_value?: string;
  platform: string;
}

export interface OpenInterestQuery {
  asset?: string;
  assetId?: number;
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  timeframe?: string;
  limit?: number;
  offset?: number;
}

export interface OpenInterestWithAsset extends OpenInterest {
  asset_symbol: string;
  asset_name: string | null;
}
