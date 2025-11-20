import 'dotenv/config';
import { query } from './src/database/connection';

async function verifyAsterOI() {
  try {
    console.log('\n=== Verifying Aster OI in Database ===\n');

    const result = await query(`
      SELECT
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM open_interest_data
      WHERE platform = 'aster'
    `);

    console.log('Aster OI Data Summary:');
    console.table(result.rows);

    const recent = await query(`
      SELECT
        a.symbol,
        oi.timestamp,
        oi.open_interest,
        oi.open_interest_value,
        oi.timeframe
      FROM open_interest_data oi
      JOIN assets a ON oi.asset_id = a.id
      WHERE oi.platform = 'aster'
      ORDER BY oi.timestamp DESC
      LIMIT 10
    `);

    console.log('\nRecent Aster OI Records:');
    console.table(recent.rows);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifyAsterOI();
