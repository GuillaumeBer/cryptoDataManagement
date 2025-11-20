import { query } from './src/database/connection';

async function checkOKXOI() {
  console.log('Checking OKX OI data in database...\n');

  try {
    // Check counts by timeframe
    const result = await query(`
      SELECT platform, timeframe, COUNT(*) as count,
             COUNT(DISTINCT asset_id) as assets,
             MIN(timestamp)::date as oldest,
             MAX(timestamp)::date as newest
      FROM open_interest_data
      WHERE platform = 'okx'
      GROUP BY platform, timeframe
      ORDER BY timeframe;
    `);

    if (result.rows.length === 0) {
      console.log('❌ NO OKX OI DATA FOUND');
      console.log('\nAction needed:');
      console.log('1. Restart the backend to load the new code');
      console.log('2. Trigger a fetch from the UI');
    } else {
      console.log('✓ Found OKX OI data:\n');
      result.rows.forEach(row => {
        console.log(`Timeframe: ${row.timeframe}`);
        console.log(`  Records: ${row.count}`);
        console.log(`  Assets: ${row.assets}`);
        console.log(`  Date range: ${row.oldest} to ${row.newest}\n`);
      });
    }

    process.exit(0);
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkOKXOI();
