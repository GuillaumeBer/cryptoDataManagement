#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';

async function checkBTC() {
  // Find BTC assets
  const btcAssets = await query(`
    SELECT id, symbol, platform, is_active
    FROM assets
    WHERE symbol ILIKE '%BTC%' AND is_active = true
    ORDER BY platform, symbol
    LIMIT 20
  `);

  console.log('\n=== BTC Assets in Database ===');
  console.log(JSON.stringify(btcAssets.rows, null, 2));

  // Check if they have OHLCV data
  if (btcAssets.rows.length > 0) {
    const assetIds = btcAssets.rows.map(a => a.id).join(',');
    const ohlcvCount = await query(`
      SELECT asset_id, COUNT(*) as count
      FROM ohlcv_data
      WHERE asset_id IN (${assetIds})
      GROUP BY asset_id
    `);

    console.log('\n=== OHLCV Data Counts ===');
    console.log(JSON.stringify(ohlcvCount.rows, null, 2));
  }

  process.exit(0);
}

checkBTC();
