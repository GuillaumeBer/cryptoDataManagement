-- Database schema for crypto data management system

-- Assets table: stores information about perpetual contracts
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(50) UNIQUE NOT NULL,
  platform VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Funding rates table: stores hourly funding rate data
CREATE TABLE IF NOT EXISTS funding_rates (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  funding_rate DECIMAL(20, 10) NOT NULL,
  premium DECIMAL(20, 10),
  platform VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_funding_rate UNIQUE(asset_id, timestamp, platform)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_funding_rates_asset_id ON funding_rates(asset_id);
CREATE INDEX IF NOT EXISTS idx_funding_rates_timestamp ON funding_rates(timestamp);
CREATE INDEX IF NOT EXISTS idx_funding_rates_asset_time ON funding_rates(asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_assets_platform ON assets(platform);
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);

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
  normalized_symbol VARCHAR(50) UNIQUE NOT NULL,
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
