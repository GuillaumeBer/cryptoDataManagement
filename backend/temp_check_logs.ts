import 'dotenv/config';
import { query } from './src/database/connection';

async function checkLogs() {
  try {
    // Check fetch logs for Binance
    const logs = await query(
      `SELECT
        id,
        platform,
        fetch_type,
        status,
        assets_processed,
        records_fetched,
        error_message,
        started_at,
        completed_at
       FROM fetch_logs
       WHERE platform = 'binance'
       ORDER BY started_at DESC
       LIMIT 10`
    );

    console.log('Binance fetch logs (last 10):');
    console.table(logs.rows);

    // Check all platforms
    const allLogs = await query(
      `SELECT
        platform,
        fetch_type,
        status,
        COUNT(*) as count,
        MAX(started_at) as last_fetch
       FROM fetch_logs
       GROUP BY platform, fetch_type, status
       ORDER BY platform, fetch_type`
    );

    console.log('\nAll fetch logs summary:');
    console.table(allLogs.rows);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkLogs();
