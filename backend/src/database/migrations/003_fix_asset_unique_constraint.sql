-- Migration: allow same symbol to exist on multiple platforms

-- Drop the old unique constraint that only covered the symbol column
ALTER TABLE assets
DROP CONSTRAINT IF EXISTS assets_symbol_key;

-- Recreate uniqueness on the combination of symbol and platform
ALTER TABLE assets
ADD CONSTRAINT assets_symbol_platform_unique UNIQUE(symbol, platform);

-- Optional supporting index for platform lookups
CREATE INDEX IF NOT EXISTS idx_assets_platform_symbol ON assets(platform, symbol);
