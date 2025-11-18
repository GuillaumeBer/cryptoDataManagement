#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';

async function checkOHLCVCoverage() {
  // Check OHLCV data by platform
  const ohlcvByPlatform = await query(`
    SELECT a.platform, COUNT(DISTINCT o.asset_id) as assets_with_ohlcv, COUNT(*) as total_records
    FROM ohlcv_data o
    JOIN assets a ON o.asset_id = a.id
    GROUP BY a.platform
    ORDER BY a.platform
  `);

  console.log('\n=== OHLCV Data by Platform ===');
  if (ohlcvByPlatform.rows.length === 0) {
    console.log('❌ NO OHLCV DATA IN DATABASE!');
  } else {
    ohlcvByPlatform.rows.forEach(r =>
      console.log(`${r.platform}: ${r.assets_with_ohlcv} assets, ${r.total_records} records`)
    );
  }

  // Check if BTC has OHLCV data on each platform
  const btcOHLCV = await query(`
    SELECT a.platform, a.symbol, COUNT(o.id) as ohlcv_count
    FROM assets a
    LEFT JOIN ohlcv_data o ON a.id = o.asset_id
    WHERE a.symbol ILIKE '%BTC%' AND a.is_active = true
    GROUP BY a.platform, a.symbol, a.id
    ORDER BY a.platform, a.symbol
  `);

  console.log('\n=== BTC OHLCV Coverage ===');
  btcOHLCV.rows.forEach(r =>
    console.log(`${r.platform}:${r.symbol} - ${r.ohlcv_count} records ${r.ohlcv_count === '0' ? '❌' : '✓'}`)
  );

  process.exit(0);
}

checkOHLCVCoverage();
