#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';

async function checkOHLCVTables() {
  // List all tables
  const tables = await query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  console.log('\n=== All Database Tables ===');
  tables.rows.forEach(r => console.log(`- ${r.tablename}`));

  // Check for OHLCV-related tables
  const ohlcvTables = tables.rows.filter(r =>
    r.tablename.toLowerCase().includes('ohlcv') ||
    r.tablename.toLowerCase().includes('candle')
  );

  console.log('\n=== OHLCV-Related Tables ===');
  if (ohlcvTables.length === 0) {
    console.log('❌ NO OHLCV TABLES FOUND!');
  } else {
    ohlcvTables.forEach(r => console.log(`- ${r.tablename}`));
  }

  // Check which platforms have data in the regular assets table
  const platformData = await query(`
    SELECT platform, COUNT(*) as asset_count
    FROM assets
    WHERE is_active = true
    GROUP BY platform
    ORDER BY platform
  `);

  console.log('\n=== Assets by Platform ===');
  platformData.rows.forEach(r => console.log(`${r.platform}: ${r.asset_count} assets`));

  process.exit(0);
}

checkOHLCVTables();
