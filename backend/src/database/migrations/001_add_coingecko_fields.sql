-- Add CoinGecko fields to unified_assets table
ALTER TABLE unified_assets
ADD COLUMN IF NOT EXISTS coingecko_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS coingecko_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS coingecko_symbol VARCHAR(100);

-- Add index for CoinGecko ID lookups
CREATE INDEX IF NOT EXISTS idx_unified_assets_coingecko_id ON unified_assets(coingecko_id);

-- Add price_correlation and last_validated_at fields to asset_mappings
ALTER TABLE asset_mappings
ADD COLUMN IF NOT EXISTS price_correlation DECIMAL(5, 4),
ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP;

-- Add index for validation tracking
CREATE INDEX IF NOT EXISTS idx_asset_mappings_last_validated ON asset_mappings(last_validated_at DESC);

-- Comments for documentation
COMMENT ON COLUMN unified_assets.coingecko_id IS 'CoinGecko API identifier (e.g., bitcoin, ethereum)';
COMMENT ON COLUMN unified_assets.coingecko_name IS 'Official name from CoinGecko (e.g., Bitcoin, Ethereum)';
COMMENT ON COLUMN unified_assets.coingecko_symbol IS 'Symbol from CoinGecko (e.g., BTC, ETH)';
COMMENT ON COLUMN asset_mappings.price_correlation IS 'Pearson correlation coefficient between platform asset and unified asset (0.0-1.0)';
COMMENT ON COLUMN asset_mappings.last_validated_at IS 'Timestamp of last price correlation validation';
