import 'dotenv/config';
import { query } from './src/database/connection';

async function checkBinanceInitial() {
  try {
    // Check the successful initial fetch
    const initialFetch = await query(
      `SELECT *
       FROM fetch_logs
       WHERE platform = 'binance'
         AND fetch_type = 'initial'
         AND status = 'success'
       ORDER BY completed_at DESC
       LIMIT 1`
    );

    console.log('Successful Binance initial fetch:');
    console.table(initialFetch.rows);

    // Check what data exists for Binance around that time
    const dataCheck = await query(
      `SELECT
        'funding_rates' as table_name,
        COUNT(*) as count,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
       FROM funding_rates
       WHERE platform = 'binance'
       UNION ALL
       SELECT
        'ohlcv_data' as table_name,
        COUNT(*) as count,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
       FROM ohlcv_data
       WHERE platform = 'binance'
       UNION ALL
       SELECT
        'open_interest_data' as table_name,
        COUNT(*) as count,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
       FROM open_interest_data
       WHERE platform = 'binance'`
    );

    console.log('\nBinance data summary:');
    console.table(dataCheck.rows);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBinanceInitial();
