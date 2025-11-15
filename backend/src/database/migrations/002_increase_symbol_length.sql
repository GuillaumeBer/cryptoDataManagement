-- Migration: Increase symbol column length for longer tickers
-- Some platforms like DyDx V4 may have tickers longer than 50 characters

-- Increase symbol length in assets table from VARCHAR(50) to VARCHAR(100)
ALTER TABLE assets
ALTER COLUMN symbol TYPE VARCHAR(100);

-- Increase normalized_symbol length in unified_assets table
ALTER TABLE unified_assets
ALTER COLUMN normalized_symbol TYPE VARCHAR(100);

-- Note: This migration is safe to run on existing data
-- VARCHAR increase does not require table rewrite in PostgreSQL
