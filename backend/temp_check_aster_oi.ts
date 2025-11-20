import 'dotenv/config';
import { query } from './src/database/connection';

async function checkAsterOI() {
  try {
    // Check if we have any OI data for Aster
    const result = await query(`
      SELECT
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM open_interest_data
      WHERE platform = 'aster'
    `);

    console.log('Aster OI Data in Database:');
    console.table(result.rows);

    // Check recent OI records
    const recent = await query(`
      SELECT
        asset,
        timestamp,
        open_interest,
        open_interest_value
      FROM open_interest_data
      WHERE platform = 'aster'
      ORDER BY timestamp DESC
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

checkAsterOI();
