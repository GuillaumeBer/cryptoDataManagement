-- Migration 004: Add OHLCV data table
-- Description: Create table for storing OHLCV (candlestick) data with 1h timeframe
--
-- Execute this script on your PostgreSQL database to add the OHLCV table:
-- Option 1: psql -U your_user -d crypto_data -f 004_add_ohlcv_table.sql
-- Option 2: Run this SQL in your PostgreSQL client (pgAdmin, DBeaver, etc.)

BEGIN;

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

-- Record migration (if you have a schema_migrations table)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO schema_migrations (migration_name)
VALUES ('004_add_ohlcv_table.sql')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;

-- Verify the table was created
SELECT 'OHLCV table created successfully!' AS status,
       COUNT(*) AS columns_count
FROM information_schema.columns
WHERE table_name = 'ohlcv_data';
