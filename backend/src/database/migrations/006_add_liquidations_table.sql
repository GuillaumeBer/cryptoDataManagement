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
