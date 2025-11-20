import 'dotenv/config';
import { query } from './src/database/connection';

async function checkHyperliquidOI() {
  try {
    // Check if we have any OI data for Hyperliquid
    const result = await query(`
      SELECT
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM open_interest_data
      WHERE platform = 'hyperliquid'
    `);

    console.log('Hyperliquid OI Data in Database:');
    console.table(result.rows);

    // Check recent OI records
    const recent = await query(`
      SELECT
        a.symbol,
        oi.timestamp,
        oi.open_interest,
        oi.open_interest_value,
        oi.timeframe
      FROM open_interest_data oi
      JOIN assets a ON oi.asset_id = a.id
      WHERE oi.platform = 'hyperliquid'
      ORDER BY oi.timestamp DESC
      LIMIT 10
    `);

    console.log('\nRecent Hyperliquid OI Records:');
    console.table(recent.rows);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkHyperliquidOI();
