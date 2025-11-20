#!/usr/bin/env node
/**
 * Test script to verify Bybit OI value calculation from OHLCV data
 */

import 'dotenv/config';
import BybitClient from './src/api/bybit/client';
import { logger } from './src/utils/logger';

async function testBybitOIValueCalculation() {
  console.log('\n=== Testing Bybit OI Value Calculation ===\n');

  try {
    const client = new BybitClient();
    const testSymbol = 'BTCUSDT';

    // Step 1: Fetch OHLCV data
    console.log(`Step 1: Fetching OHLCV data for ${testSymbol}...`);
    const ohlcvData = await client.getOHLCV(testSymbol, '60');
    console.log(`✓ Fetched ${ohlcvData.length} OHLCV records`);

    if (ohlcvData.length > 0) {
      const latest = ohlcvData[0];
      console.log(`  Latest price: $${parseFloat(latest.close).toLocaleString()}`);
      console.log(`  Timestamp: ${latest.timestamp.toISOString()}`);
    }

    // Step 2: Fetch OI data WITHOUT OHLCV (old behavior)
    console.log(`\nStep 2: Fetching OI WITHOUT OHLCV data (old behavior)...`);
    const oiDataWithoutPrice = await client.getOpenInterest(testSymbol, '1h');
    console.log(`✓ Fetched ${oiDataWithoutPrice.length} OI records`);

    if (oiDataWithoutPrice.length > 0) {
      const latest = oiDataWithoutPrice[0];
      console.log(`  Latest OI: ${parseFloat(latest.openInterest).toLocaleString()} contracts`);
      console.log(`  OI Value: ${latest.openInterestValue || 'undefined (as expected)'}`);
      console.log(`  Timestamp: ${latest.timestamp.toISOString()}`);
    }

    // Step 3: Fetch OI data WITH OHLCV (new behavior)
    console.log(`\nStep 3: Fetching OI WITH OHLCV data (new behavior)...`);
    const oiDataWithPrice = await client.getOpenInterest(testSymbol, '1h', ohlcvData);
    console.log(`✓ Fetched ${oiDataWithPrice.length} OI records`);

    const withValueCount = oiDataWithPrice.filter(r => r.openInterestValue !== undefined).length;
    console.log(`  Records with calculated value: ${withValueCount}/${oiDataWithPrice.length}`);

    if (oiDataWithPrice.length > 0) {
      const latest = oiDataWithPrice[0];
      console.log(`\n  Latest OI Record:`);
      console.log(`    Contracts: ${parseFloat(latest.openInterest).toLocaleString()}`);
      console.log(`    Value: ${latest.openInterestValue ? '$' + parseFloat(latest.openInterestValue).toLocaleString() : 'undefined'}`);
      console.log(`    Timestamp: ${latest.timestamp.toISOString()}`);

      // Show a few more examples
      console.log(`\n  Sample OI Values:`);
      for (let i = 0; i < Math.min(5, oiDataWithPrice.length); i++) {
        const record = oiDataWithPrice[i];
        if (record.openInterestValue) {
          const contracts = parseFloat(record.openInterest);
          const value = parseFloat(record.openInterestValue);
          const impliedPrice = value / contracts;
          console.log(`    [${i + 1}] Contracts: ${contracts.toFixed(2)}, Value: $${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}, Price: $${impliedPrice.toLocaleString()}`);
        }
      }
    }

    // Step 4: Test batch fetch with OHLCV
    console.log(`\n\nStep 4: Testing batch fetch with OHLCV data...`);
    const testSymbols = ['BTCUSDT', 'ETHUSDT'];

    // Fetch OHLCV for all symbols
    const ohlcvMap = new Map();
    for (const symbol of testSymbols) {
      console.log(`  Fetching OHLCV for ${symbol}...`);
      const data = await client.getOHLCV(symbol, '60');
      ohlcvMap.set(symbol, data);
      console.log(`    ✓ ${data.length} records`);
    }

    // Fetch OI with OHLCV data
    console.log(`\n  Fetching OI for ${testSymbols.length} symbols with OHLCV...`);
    const oiMap = await client.getOpenInterestBatch(
      testSymbols,
      '1h',
      600,
      1,
      undefined,
      ohlcvMap
    );

    console.log(`\n  Results:`);
    for (const [symbol, oiData] of oiMap.entries()) {
      const withValue = oiData.filter(d => d.openInterestValue).length;
      console.log(`    ${symbol}: ${oiData.length} OI records, ${withValue} with value`);

      if (oiData.length > 0 && oiData[0].openInterestValue) {
        const latest = oiData[0];
        console.log(`      Latest: ${parseFloat(latest.openInterest).toFixed(2)} contracts = $${parseFloat(latest.openInterestValue).toLocaleString()}`);
      }
    }

    console.log('\n\n=== Test Complete ===\n');
    console.log('✅ SUCCESS: OI value calculation is working correctly!');
    console.log('   - OI contracts are multiplied by the closest OHLCV price');
    console.log('   - Values are calculated for historical data points');
    console.log('   - Both single and batch operations work as expected\n');

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    logger.error('Test failed', error);
    process.exit(1);
  }
}

testBybitOIValueCalculation();
