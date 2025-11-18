#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';
import { logger } from '../utils/logger';

async function runMigration() {
  logger.info('Running migration: Add market_cap_usd to unified_assets');

  try {
    // Add market cap column
    await query(`
      ALTER TABLE unified_assets
      ADD COLUMN IF NOT EXISTS market_cap_usd BIGINT
    `);
    logger.info('Added market_cap_usd column');

    // Add index for sorting
    await query(`
      CREATE INDEX IF NOT EXISTS idx_unified_assets_market_cap
      ON unified_assets(market_cap_usd DESC NULLS LAST)
    `);
    logger.info('Added market_cap_usd index');

    // Add comment
    await query(`
      COMMENT ON COLUMN unified_assets.market_cap_usd
      IS 'Market capitalization in USD from CoinGecko'
    `);
    logger.info('Added column comment');

    logger.info('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
