import 'dotenv/config';
import { query } from './src/database/connection';

async function checkOIData() {
  try {
    const result = await query(
      `SELECT COUNT(*) as count, platform, timeframe
       FROM open_interest_data
       GROUP BY platform, timeframe
       ORDER BY platform, timeframe`
    );

    console.log('Open Interest data by platform and timeframe:');
    console.table(result.rows);

    // Check specifically for Binance
    const binanceResult = await query(
      `SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT asset_id) as unique_assets,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
       FROM open_interest_data
       WHERE platform = 'binance'`
    );

    console.log('\nBinance OI data details:');
    console.table(binanceResult.rows);

    // Check a sample of Binance assets
    const sampleAssets = await query(
      `SELECT
        a.symbol,
        a.name,
        COUNT(oi.*) as record_count,
        MIN(oi.timestamp) as earliest,
        MAX(oi.timestamp) as latest
       FROM assets a
       LEFT JOIN open_interest_data oi ON a.id = oi.asset_id AND oi.platform = 'binance'
       WHERE a.platform = 'binance'
       GROUP BY a.id, a.symbol, a.name
       ORDER BY record_count DESC
       LIMIT 10`
    );

    console.log('\nTop 10 Binance assets by OI record count:');
    console.table(sampleAssets.rows);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkOIData();
