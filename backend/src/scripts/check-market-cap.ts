#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';

async function checkMarketCap() {
  const result = await query(
    `SELECT id, normalized_symbol, display_name, market_cap_usd
     FROM unified_assets
     WHERE normalized_symbol IN ('BTC', 'ETH', 'SOL', 'AAVE', '2Z')
     ORDER BY normalized_symbol`
  );

  console.log('Market cap in database:');
  console.table(result.rows);

  process.exit(0);
}

checkMarketCap().catch(console.error);
