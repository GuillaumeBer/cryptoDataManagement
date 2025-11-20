import db from './src/config/database';

async function checkOKXOIData() {
  console.log('=== Checking OKX Open Interest Data in Database ===\n');

  try {
    // Check OI records by timeframe
    const result = await db.query(`
      SELECT
        platform,
        timeframe,
        COUNT(*) as record_count,
        COUNT(DISTINCT asset_id) as unique_assets,
        MIN(timestamp) as oldest_date,
        MAX(timestamp) as newest_date
      FROM open_interest
      WHERE platform = 'okx'
      GROUP BY platform, timeframe
      ORDER BY timeframe;
    `);

    if (result.rows.length === 0) {
      console.log('⚠️  NO OKX OI DATA FOUND IN DATABASE');
      console.log('\nThis means either:');
      console.log('1. You haven\'t run a fetch yet with the updated code');
      console.log('2. The backend needs to be restarted to pick up the new code');
      console.log('3. The fetch encountered errors');
    } else {
      console.log('Found OKX OI data:');
      console.table(result.rows);

      // Check sample records
      const samples = await db.query(`
        SELECT
          a.symbol,
          oi.timestamp,
          oi.timeframe,
          oi.open_interest,
          oi.open_interest_value
        FROM open_interest oi
        JOIN assets a ON oi.asset_id = a.id
        WHERE oi.platform = 'okx'
        ORDER BY a.symbol, oi.timestamp DESC
        LIMIT 10;
      `);

      console.log('\nSample records:');
      console.table(samples.rows);
    }

    // Check for 1h vs 1d timeframe
    const timeframeCheck = await db.query(`
      SELECT timeframe, COUNT(*)
      FROM open_interest
      WHERE platform = 'okx'
      GROUP BY timeframe;
    `);

    console.log('\nTimeframe distribution:');
    console.table(timeframeCheck.rows);

    await db.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkOKXOIData();
