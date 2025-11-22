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
  timeframe?: string;
  limit?: number;
  offset?: number;
}

export interface OHLCVWithAsset extends OHLCVData {
  asset_symbol: string;
  asset_name: string | null;
}

export interface OpenInterestData {
  id: number;
  asset_id: number;
  timestamp: Date;
  timeframe: string; // '1h', '4h', etc.
  open_interest: string; // Base asset amount
  open_interest_value: string | null; // USD value
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

export interface OpenInterestWithAsset extends OpenInterestData {
  asset_symbol: string;
  asset_name: string | null;
}

export interface LongShortRatio {
  id: number;
  asset_id: number;
  timestamp: Date;
  timeframe: string; // '5m', '15m', '30m', '1h', '4h', '1d'
  long_account: string | null; // Ratio of accounts with long positions
  short_account: string | null; // Ratio of accounts with short positions
  long_short_ratio: string; // The ratio value
  long_ratio: string;
  short_ratio: string;
  platform: string;
  type: string;
  period: string;
  fetched_at: Date;
}

export interface CreateLongShortRatioParams {
  asset_id: number;
  timestamp: Date;
  long_ratio: string;
  short_ratio: string;
  long_account?: string | null;
  short_account?: string | null;
  platform: string;
  type: string;
  period: string;
}

export interface LongShortRatioQuery {
  asset?: string;
  assetId?: number;
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  timeframe?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface LongShortRatioWithAsset extends LongShortRatio {
  asset_symbol: string;
  asset_name: string | null;
}

export interface LiquidationRecord {
  id: number;
  asset_id: number;
  timestamp: Date;
  side: 'Long' | 'Short';
  price: number;
  quantity: number;
  volume_usd: number;
  platform: string;
  fetched_at: Date;
}

export interface CreateLiquidationParams {
  asset_id: number;
  timestamp: Date;
  side: 'Long' | 'Short';
  price: number;
  quantity: number;
  volume_usd: number;
  platform: string;
}

export interface LiquidationQuery {
  asset?: string;
  assetId?: number;
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  limit?: number;
  offset?: number;
}

export interface LiquidationWithAsset extends LiquidationRecord {
  asset_symbol: string;
  asset_name: string | null;
}
