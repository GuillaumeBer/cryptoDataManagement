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
