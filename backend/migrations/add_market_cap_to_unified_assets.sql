-- Add market cap column to unified_assets table
ALTER TABLE unified_assets
ADD COLUMN IF NOT EXISTS market_cap_usd BIGINT;

-- Add index for sorting by market cap
CREATE INDEX IF NOT EXISTS idx_unified_assets_market_cap
ON unified_assets(market_cap_usd DESC NULLS LAST);

-- Add comment
COMMENT ON COLUMN unified_assets.market_cap_usd IS 'Market capitalization in USD from CoinGecko';
