CREATE TABLE IF NOT EXISTS long_short_ratios (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  long_ratio NUMERIC NOT NULL,
  short_ratio NUMERIC NOT NULL,
  long_account NUMERIC, -- Optional: Number of long accounts (if available)
  short_account NUMERIC, -- Optional: Number of short accounts (if available)
  platform VARCHAR(50) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'global_account', -- 'global_account', 'top_trader_position', 'top_trader_account'
  period VARCHAR(20) NOT NULL DEFAULT '1h', -- '5m', '15m', '1h', '4h', '1d'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique records per asset/timestamp/platform/type/period
  CONSTRAINT uq_ls_ratio_asset_ts_type UNIQUE (asset_id, timestamp, platform, type, period)
);

-- Index for fast time-range queries
CREATE INDEX idx_ls_ratios_asset_ts ON long_short_ratios(asset_id, timestamp DESC);
CREATE INDEX idx_ls_ratios_platform_ts ON long_short_ratios(platform, timestamp DESC);
