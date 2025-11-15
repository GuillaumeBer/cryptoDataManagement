-- Migration: Add sampling_interval column to funding_rates table
-- This migration adds support for multiple sampling rates (1h, 8h, etc.)

-- Add the sampling_interval column with default value '1h'
ALTER TABLE funding_rates
ADD COLUMN IF NOT EXISTS sampling_interval VARCHAR(10) DEFAULT '1h' NOT NULL;

-- Update the unique constraint to include sampling_interval
ALTER TABLE funding_rates
DROP CONSTRAINT IF EXISTS unique_funding_rate;

ALTER TABLE funding_rates
ADD CONSTRAINT unique_funding_rate UNIQUE(asset_id, timestamp, platform, sampling_interval);

-- Add new indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_funding_rates_sampling_interval ON funding_rates(sampling_interval);
CREATE INDEX IF NOT EXISTS idx_funding_rates_platform_interval ON funding_rates(platform, sampling_interval);

-- Note: Existing data will have sampling_interval='1h' by default
-- Hyperliquid data is hourly (1h)
-- Binance data should be marked as 8h when inserted
