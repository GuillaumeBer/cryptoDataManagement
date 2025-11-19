-- Add market_cap_rank column to unified_assets table
ALTER TABLE unified_assets 
ADD COLUMN IF NOT EXISTS market_cap_rank INTEGER;

-- Add index for sorting by rank
CREATE INDEX IF NOT EXISTS idx_unified_assets_market_cap_rank 
ON unified_assets(market_cap_rank) 
WHERE market_cap_rank IS NOT NULL;

-- Add comment
COMMENT ON COLUMN unified_assets.market_cap_rank IS 'CoinGecko market cap rank position';
