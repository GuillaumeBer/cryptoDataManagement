-- Database schema for crypto data management system

-- Assets table: stores information about perpetual contracts
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(100) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT assets_symbol_platform_unique UNIQUE(symbol, platform)
);

-- Funding rates table: stores funding rate data at various sampling intervals
CREATE TABLE IF NOT EXISTS funding_rates (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  funding_rate DECIMAL(20, 10) NOT NULL,
  premium DECIMAL(20, 10),
  platform VARCHAR(50) NOT NULL,
  sampling_interval VARCHAR(10) DEFAULT '1h' NOT NULL, -- '1h', '8h', etc.
  fetched_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_funding_rate UNIQUE(asset_id, timestamp, platform, sampling_interval)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_funding_rates_asset_id ON funding_rates(asset_id);
CREATE INDEX IF NOT EXISTS idx_funding_rates_timestamp ON funding_rates(timestamp);
CREATE INDEX IF NOT EXISTS idx_funding_rates_asset_time ON funding_rates(asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_funding_rates_sampling_interval ON funding_rates(sampling_interval);
CREATE INDEX IF NOT EXISTS idx_funding_rates_platform_interval ON funding_rates(platform, sampling_interval);
CREATE INDEX IF NOT EXISTS idx_assets_platform ON assets(platform);
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);

-- OHLCV data table: stores candlestick/kline data at various timeframes
CREATE TABLE IF NOT EXISTS ohlcv_data (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  timeframe VARCHAR(10) NOT NULL, -- '1m', '5m', '15m', '1h', '4h', '1d', etc.
  open DECIMAL(20, 10) NOT NULL,
  high DECIMAL(20, 10) NOT NULL,
  low DECIMAL(20, 10) NOT NULL,
  close DECIMAL(20, 10) NOT NULL,
  volume DECIMAL(30, 10),
  quote_volume DECIMAL(30, 10),
  trades_count INTEGER,
  platform VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_ohlcv UNIQUE(asset_id, timestamp, platform, timeframe)
);

-- Indexes for OHLCV data for faster queries
CREATE INDEX IF NOT EXISTS idx_ohlcv_asset_id ON ohlcv_data(asset_id);
CREATE INDEX IF NOT EXISTS idx_ohlcv_timestamp ON ohlcv_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_ohlcv_asset_time ON ohlcv_data(asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ohlcv_timeframe ON ohlcv_data(timeframe);
CREATE INDEX IF NOT EXISTS idx_ohlcv_platform_timeframe ON ohlcv_data(platform, timeframe);

-- Open Interest data table: stores open interest (OI) data at various timeframes
CREATE TABLE IF NOT EXISTS open_interest_data (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  timeframe VARCHAR(10) NOT NULL, -- '1h', '4h', '1d', etc.
  open_interest DECIMAL(30, 10) NOT NULL, -- Number of contracts
  open_interest_value DECIMAL(30, 10), -- USD value (if available)
  platform VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_open_interest UNIQUE(asset_id, timestamp, platform, timeframe)
);

-- Indexes for Open Interest data for faster queries
CREATE INDEX IF NOT EXISTS idx_oi_asset_id ON open_interest_data(asset_id);
CREATE INDEX IF NOT EXISTS idx_oi_timestamp ON open_interest_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_oi_asset_time ON open_interest_data(asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_oi_timeframe ON open_interest_data(timeframe);
CREATE INDEX IF NOT EXISTS idx_oi_platform_timeframe ON open_interest_data(platform, timeframe);

-- Long/short ratios provide sentiment snapshots for platforms and assets
CREATE TABLE IF NOT EXISTS long_short_ratios (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  long_ratio NUMERIC NOT NULL,
  short_ratio NUMERIC NOT NULL,
  long_account NUMERIC,
  short_account NUMERIC,
  platform VARCHAR(50) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'global_account',
  period VARCHAR(20) NOT NULL DEFAULT '1h',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ls_ratio_asset_ts_type UNIQUE (asset_id, timestamp, platform, type, period)
);

CREATE INDEX IF NOT EXISTS idx_ls_ratios_asset_ts ON long_short_ratios(asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ls_ratios_platform_ts ON long_short_ratios(platform, timestamp DESC);

-- Liquidations table: stores forced liquidation orders per asset/platform
CREATE TABLE IF NOT EXISTS liquidations (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('Long', 'Short')),
  price DECIMAL(20, 10) NOT NULL,
  quantity DECIMAL(30, 10) NOT NULL,
  volume_usd DECIMAL(30, 10) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_liquidation UNIQUE(asset_id, platform, timestamp, side, price, quantity)
);

CREATE INDEX IF NOT EXISTS idx_liquidations_asset_platform_timestamp ON liquidations(asset_id, platform, timestamp);
CREATE INDEX IF NOT EXISTS idx_liquidations_timestamp ON liquidations(timestamp);

-- Fetch logs table: tracks data fetch operations
CREATE TABLE IF NOT EXISTS fetch_logs (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(50) NOT NULL,
  fetch_type VARCHAR(50) NOT NULL, -- 'initial', 'incremental'
  status VARCHAR(50) NOT NULL, -- 'success', 'failed', 'partial'
  assets_processed INTEGER DEFAULT 0,
  records_fetched INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fetch_logs_platform ON fetch_logs(platform);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_started_at ON fetch_logs(started_at DESC);

-- Unified assets table: represents a single asset across all platforms
CREATE TABLE IF NOT EXISTS unified_assets (
  id SERIAL PRIMARY KEY,
  normalized_symbol VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Asset mappings table: links platform-specific assets to unified assets
CREATE TABLE IF NOT EXISTS asset_mappings (
  id SERIAL PRIMARY KEY,
  unified_asset_id INTEGER NOT NULL REFERENCES unified_assets(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  confidence_score INTEGER DEFAULT 100 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  mapping_method VARCHAR(50) NOT NULL, -- 'auto_symbol', 'auto_price', 'manual'
  price_used DECIMAL(20, 10), -- Mark price used for validation (if applicable)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_asset_mapping UNIQUE(unified_asset_id, asset_id)
);

-- Indexes for unified assets
CREATE INDEX IF NOT EXISTS idx_unified_assets_normalized_symbol ON unified_assets(normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_asset_mappings_unified_asset_id ON asset_mappings(unified_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_mappings_asset_id ON asset_mappings(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_mappings_confidence ON asset_mappings(confidence_score DESC);
