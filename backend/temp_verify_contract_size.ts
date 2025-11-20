#!/usr/bin/env node
/**
 * Verify contract size and OI calculation for Bybit
 */

import 'dotenv/config';
import BybitClient from './src/api/bybit/client';
import BinanceClient from './src/api/binance/client';

async function verifyContractSize() {
  console.log('\n=== Verifying Contract Size & OI Calculation ===\n');

  try {
    const bybitClient = new BybitClient();
    const binanceClient = new BinanceClient();

    // Get instrument info from Bybit
    console.log('Step 1: Fetching BTCUSDT contract specifications from Bybit...');
    const assets = await bybitClient.getAssets();
    const btcContract = assets.find(a => a.symbol === 'BTCUSDT');

    if (btcContract) {
      console.log('\nBybit BTCUSDT Contract Info:');
      console.log('  Symbol:', btcContract.symbol);
      console.log('  Base Coin:', btcContract.baseCoin);
      console.log('  Quote Coin:', btcContract.quoteCoin);
      console.log('  Contract Type:', btcContract.contractType);
      console.log('  Lot Size Filter:');
      console.log('    - Min Order Qty:', btcContract.lotSizeFilter.minOrderQty, btcContract.baseCoin);
      console.log('    - Max Order Qty:', btcContract.lotSizeFilter.maxOrderQty, btcContract.baseCoin);
      console.log('    - Qty Step:', btcContract.lotSizeFilter.qtyStep, btcContract.baseCoin);
      console.log('\n  Note: For linear perpetuals, quantities are in BASE CURRENCY (BTC)');
      console.log('        Contract size = 1 BTC (no multiplier)');
    }

    // Compare Bybit vs Binance OI
    console.log('\n\nStep 2: Comparing OI values between Bybit and Binance...\n');

    // Fetch current price
    const ohlcv = await bybitClient.getOHLCV('BTCUSDT', '60');
    const currentPrice = ohlcv.length > 0 ? parseFloat(ohlcv[0].close) : 0;

    // Fetch Bybit OI (with calculation)
    const bybitOI = await bybitClient.getOpenInterest('BTCUSDT', '1h', ohlcv);

    // Fetch Binance OI (they provide the value directly)
    const binanceOI = await binanceClient.getOpenInterest('BTCUSDT', '1h');

    if (bybitOI.length > 0 && binanceOI.length > 0) {
      const bybitLatest = bybitOI[0];
      const binanceLatest = binanceOI[0];

      console.log('Current BTC Price: $' + currentPrice.toLocaleString());
      console.log('\nBybit:');
      console.log('  OI (contracts):', parseFloat(bybitLatest.openInterest).toLocaleString(), 'BTC');
      console.log('  OI Value (calculated):', bybitLatest.openInterestValue
        ? '$' + parseFloat(bybitLatest.openInterestValue).toLocaleString(undefined, { maximumFractionDigits: 0 })
        : 'N/A');
      console.log('  Calculation:', parseFloat(bybitLatest.openInterest).toFixed(2), 'BTC ×', '$' + currentPrice.toLocaleString());

      console.log('\nBinance:');
      console.log('  OI (contracts):', parseFloat(binanceLatest.openInterest).toLocaleString(), 'BTC');
      console.log('  OI Value (from API):', binanceLatest.openInterestValue
        ? '$' + parseFloat(binanceLatest.openInterestValue).toLocaleString(undefined, { maximumFractionDigits: 0 })
        : 'N/A');

      // Check if they're in the same ballpark
      if (bybitLatest.openInterestValue && binanceLatest.openInterestValue) {
        const bybitValue = parseFloat(bybitLatest.openInterestValue);
        const binanceValue = parseFloat(binanceLatest.openInterestValue);
        const diff = Math.abs(bybitValue - binanceValue);
        const diffPercent = (diff / binanceValue) * 100;

        console.log('\nComparison:');
        console.log('  Difference: $' + diff.toLocaleString(undefined, { maximumFractionDigits: 0 }));
        console.log('  Difference %:', diffPercent.toFixed(2) + '%');

        if (diffPercent < 10) {
          console.log('  ✅ Values are similar - calculation appears correct!');
        } else {
          console.log('  ⚠️  Large difference - may need contract size adjustment');
        }
      }

      // Show the formula
      console.log('\n\n=== Formula Verification ===');
      console.log('For LINEAR perpetuals (BTCUSDT):');
      console.log('  OI API returns: Amount in base currency (BTC)');
      console.log('  Contract size: 1 (no multiplier for linear contracts)');
      console.log('  Formula: OI Value = OI_quantity × Price');
      console.log('  Example: ' + parseFloat(bybitLatest.openInterest).toFixed(2) + ' BTC × $' + currentPrice.toFixed(2) + ' = $' + (parseFloat(bybitLatest.openInterest) * currentPrice).toLocaleString());
    }

    console.log('\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  }
}

verifyContractSize();
