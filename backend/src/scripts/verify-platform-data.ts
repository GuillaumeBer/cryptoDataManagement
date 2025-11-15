/**
 * Platform Data Verification Script
 *
 * This script independently fetches data from each platform's API
 * and compares it with the data stored in our database to verify correctness.
 */

import 'dotenv/config';
import { HyperliquidClient } from '../api/hyperliquid/client';
import { BinanceClient } from '../api/binance/client';
import { BybitClient } from '../api/bybit/client';
import { OKXClient } from '../api/okx/client';
import FundingRateRepository from '../models/FundingRateRepository';
import AssetRepository from '../models/AssetRepository';
import { closePool } from '../database/connection';

interface VerificationResult {
  platform: string;
  asset: string;
  apiDataPoints: number;
  dbDataPoints: number;
  samplingInterval: string;
  apiSampleRate?: string;
  dbSampleRate?: string;
  rateMatches: boolean;
  timestampMatches: boolean;
  sampleRates?: { api: string; db: string; match: boolean }[];
  errors: string[];
}

/**
 * Verify Binance funding rate data
 */
async function verifyBinance(asset: string = 'BTCUSDT'): Promise<VerificationResult> {
  console.log(`\n[BINANCE] Verifying ${asset}...`);
  const result: VerificationResult = {
    platform: 'binance',
    asset,
    apiDataPoints: 0,
    dbDataPoints: 0,
    samplingInterval: '8h',
    rateMatches: false,
    timestampMatches: false,
    sampleRates: [],
    errors: [],
  };

  try {
    // Fetch from Binance API
    const client = new BinanceClient();
    const apiData = await client.getFundingHistory(asset, 72); // Last 72 hours = 9 data points
    result.apiDataPoints = apiData.length;

    console.log(`  API returned ${apiData.length} data points`);

    // Fetch from database
    const dbAsset = await AssetRepository.findBySymbol(asset, 'binance');
    if (!dbAsset) {
      result.errors.push('Asset not found in database');
      return result;
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const dbData = await FundingRateRepository.find({
      asset: asset,
      platform: 'binance',
      sampling_interval: '8h',
      startDate,
      endDate: now,
      limit: 100,
    });
    result.dbDataPoints = dbData.length;

    console.log(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0]; // Repository returns DESC order

    console.log(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    console.log(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

    // Check if rates match (within 0.0001% tolerance for floating point)
    const apiRate = parseFloat(latestApi.fundingRate);
    const dbRate = parseFloat(latestDb.funding_rate);
    const rateDiff = Math.abs(apiRate - dbRate);
    result.rateMatches = rateDiff < 0.000001;

    // Check timestamp alignment (should be at 00:00, 08:00, or 16:00 UTC)
    const apiTime = new Date(latestApi.timestamp);
    const dbTime = new Date(latestDb.timestamp);
    const timeDiff = Math.abs(apiTime.getTime() - dbTime.getTime());
    result.timestampMatches = timeDiff < 60000; // Within 1 minute

    // Compare multiple data points
    const samplesToCheck = Math.min(3, apiData.length, dbData.length);
    for (let i = 0; i < samplesToCheck; i++) {
      const api = apiData[apiData.length - 1 - i];
      const db = dbData[i];
      const apiR = parseFloat(api.fundingRate);
      const dbR = parseFloat(db.funding_rate);
      const match = Math.abs(apiR - dbR) < 0.000001;

      result.sampleRates?.push({
        api: api.fundingRate,
        db: db.funding_rate,
        match,
      });

      if (!match) {
        result.errors.push(`Rate mismatch at index ${i}: API=${api.fundingRate}, DB=${db.funding_rate}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error: ${error}`);
  }

  return result;
}

/**
 * Verify Hyperliquid funding rate data
 */
async function verifyHyperliquid(asset: string = 'BTC'): Promise<VerificationResult> {
  console.log(`\n[HYPERLIQUID] Verifying ${asset}...`);
  const result: VerificationResult = {
    platform: 'hyperliquid',
    asset,
    apiDataPoints: 0,
    dbDataPoints: 0,
    samplingInterval: '1h',
    rateMatches: false,
    timestampMatches: false,
    sampleRates: [],
    errors: [],
  };

  try {
    // Fetch from Hyperliquid API
    const client = new HyperliquidClient();
    const apiData = await client.getFundingHistory(asset, 24); // Last 24 hours
    result.apiDataPoints = apiData.length;

    console.log(`  API returned ${apiData.length} data points`);

    // Fetch from database
    const dbAsset = await AssetRepository.findBySymbol(asset, 'hyperliquid');
    if (!dbAsset) {
      result.errors.push('Asset not found in database');
      return result;
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dbData = await FundingRateRepository.find({
      asset: asset,
      platform: 'hyperliquid',
      sampling_interval: '1h',
      startDate,
      endDate: now,
      limit: 100,
    });
    result.dbDataPoints = dbData.length;

    console.log(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0];

    console.log(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    console.log(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

    const apiRate = parseFloat(latestApi.fundingRate);
    const dbRate = parseFloat(latestDb.funding_rate);
    const rateDiff = Math.abs(apiRate - dbRate);
    result.rateMatches = rateDiff < 0.000001;

    const apiTime = new Date(latestApi.timestamp);
    const dbTime = new Date(latestDb.timestamp);
    const timeDiff = Math.abs(apiTime.getTime() - dbTime.getTime());
    result.timestampMatches = timeDiff < 60000;

    // Compare multiple data points
    const samplesToCheck = Math.min(5, apiData.length, dbData.length);
    for (let i = 0; i < samplesToCheck; i++) {
      const api = apiData[apiData.length - 1 - i];
      const db = dbData[i];
      const apiR = parseFloat(api.fundingRate);
      const dbR = parseFloat(db.funding_rate);
      const match = Math.abs(apiR - dbR) < 0.000001;

      result.sampleRates?.push({
        api: api.fundingRate,
        db: db.funding_rate,
        match,
      });

      if (!match) {
        result.errors.push(`Rate mismatch at index ${i}: API=${api.fundingRate}, DB=${db.funding_rate}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error: ${error}`);
  }

  return result;
}

/**
 * Verify Bybit funding rate data
 */
async function verifyBybit(asset: string = 'BTCUSDT'): Promise<VerificationResult> {
  console.log(`\n[BYBIT] Verifying ${asset}...`);
  const result: VerificationResult = {
    platform: 'bybit',
    asset,
    apiDataPoints: 0,
    dbDataPoints: 0,
    samplingInterval: '8h',
    rateMatches: false,
    timestampMatches: false,
    sampleRates: [],
    errors: [],
  };

  try {
    // Fetch from Bybit API
    const client = new BybitClient();
    const apiData = await client.getFundingHistory(asset, 72); // Last 72 hours
    result.apiDataPoints = apiData.length;

    console.log(`  API returned ${apiData.length} data points`);

    // Fetch from database
    const dbAsset = await AssetRepository.findBySymbol(asset, 'bybit');
    if (!dbAsset) {
      result.errors.push('Asset not found in database');
      return result;
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const dbData = await FundingRateRepository.find({
      asset: asset,
      platform: 'bybit',
      sampling_interval: '8h',
      startDate,
      endDate: now,
      limit: 100,
    });
    result.dbDataPoints = dbData.length;

    console.log(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0];

    console.log(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    console.log(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

    const apiRate = parseFloat(latestApi.fundingRate);
    const dbRate = parseFloat(latestDb.funding_rate);
    const rateDiff = Math.abs(apiRate - dbRate);
    result.rateMatches = rateDiff < 0.000001;

    const apiTime = new Date(latestApi.timestamp);
    const dbTime = new Date(latestDb.timestamp);
    const timeDiff = Math.abs(apiTime.getTime() - dbTime.getTime());
    result.timestampMatches = timeDiff < 60000;

    // Compare multiple data points
    const samplesToCheck = Math.min(3, apiData.length, dbData.length);
    for (let i = 0; i < samplesToCheck; i++) {
      const api = apiData[apiData.length - 1 - i];
      const db = dbData[i];
      const apiR = parseFloat(api.fundingRate);
      const dbR = parseFloat(db.funding_rate);
      const match = Math.abs(apiR - dbR) < 0.000001;

      result.sampleRates?.push({
        api: api.fundingRate,
        db: db.funding_rate,
        match,
      });

      if (!match) {
        result.errors.push(`Rate mismatch at index ${i}: API=${api.fundingRate}, DB=${db.funding_rate}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error: ${error}`);
  }

  return result;
}

/**
 * Verify OKX funding rate data
 */
async function verifyOKX(asset: string = 'BTC-USDT-SWAP'): Promise<VerificationResult> {
  console.log(`\n[OKX] Verifying ${asset}...`);
  const result: VerificationResult = {
    platform: 'okx',
    asset,
    apiDataPoints: 0,
    dbDataPoints: 0,
    samplingInterval: '8h',
    rateMatches: false,
    timestampMatches: false,
    sampleRates: [],
    errors: [],
  };

  try {
    // Fetch from OKX API
    const client = new OKXClient();
    const apiData = await client.getFundingHistory(asset, 72); // Last 72 hours
    result.apiDataPoints = apiData.length;

    console.log(`  API returned ${apiData.length} data points`);

    // Fetch from database
    const dbAsset = await AssetRepository.findBySymbol(asset, 'okx');
    if (!dbAsset) {
      result.errors.push('Asset not found in database');
      return result;
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const dbData = await FundingRateRepository.find({
      asset: asset,
      platform: 'okx',
      sampling_interval: '8h',
      startDate,
      endDate: now,
      limit: 100,
    });
    result.dbDataPoints = dbData.length;

    console.log(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0];

    console.log(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    console.log(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

    const apiRate = parseFloat(latestApi.fundingRate);
    const dbRate = parseFloat(latestDb.funding_rate);
    const rateDiff = Math.abs(apiRate - dbRate);
    result.rateMatches = rateDiff < 0.000001;

    const apiTime = new Date(latestApi.timestamp);
    const dbTime = new Date(latestDb.timestamp);
    const timeDiff = Math.abs(apiTime.getTime() - dbTime.getTime());
    result.timestampMatches = timeDiff < 60000;

    // Compare multiple data points
    const samplesToCheck = Math.min(3, apiData.length, dbData.length);
    for (let i = 0; i < samplesToCheck; i++) {
      const api = apiData[apiData.length - 1 - i];
      const db = dbData[i];
      const apiR = parseFloat(api.fundingRate);
      const dbR = parseFloat(db.funding_rate);
      const match = Math.abs(apiR - dbR) < 0.000001;

      result.sampleRates?.push({
        api: api.fundingRate,
        db: db.funding_rate,
        match,
      });

      if (!match) {
        result.errors.push(`Rate mismatch at index ${i}: API=${api.fundingRate}, DB=${db.funding_rate}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error: ${error}`);
  }

  return result;
}

/**
 * Generate verification report
 */
function generateReport(results: VerificationResult[]): void {
  console.log('\n========================================');
  console.log('PLATFORM DATA VERIFICATION REPORT');
  console.log('========================================\n');

  let allPassed = true;

  for (const result of results) {
    const status = result.errors.length === 0 && result.rateMatches && result.timestampMatches ? '✓ PASS' : '✗ FAIL';
    allPassed = allPassed && status === '✓ PASS';

    console.log(`\n${result.platform.toUpperCase()} - ${result.asset}: ${status}`);
    console.log(`  Sampling Interval: ${result.samplingInterval}`);
    console.log(`  API Data Points: ${result.apiDataPoints}`);
    console.log(`  DB Data Points: ${result.dbDataPoints}`);
    console.log(`  Rate Match: ${result.rateMatches ? '✓' : '✗'}`);
    console.log(`  Timestamp Match: ${result.timestampMatches ? '✓' : '✗'}`);

    if (result.sampleRates && result.sampleRates.length > 0) {
      console.log('\n  Sample Comparisons:');
      result.sampleRates.forEach((sample, idx) => {
        console.log(`    [${idx}] API: ${sample.api} | DB: ${sample.db} | ${sample.match ? '✓' : '✗'}`);
      });
    }

    if (result.errors.length > 0) {
      console.log('\n  Errors:');
      result.errors.forEach(err => console.log(`    - ${err}`));
    }
  }

  console.log('\n========================================');
  console.log(`OVERALL: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  console.log('========================================\n');
}

/**
 * Main verification function
 */
async function main() {
  console.log('Starting platform data verification...\n');

  const results: VerificationResult[] = [];

  // Test each platform
  results.push(await verifyBinance('BTCUSDT'));
  results.push(await verifyBinance('ETHUSDT'));
  results.push(await verifyBinance('CRVUSDT'));

  results.push(await verifyHyperliquid('BTC'));
  results.push(await verifyHyperliquid('ETH'));

  results.push(await verifyBybit('BTCUSDT'));
  results.push(await verifyBybit('ETHUSDT'));

  results.push(await verifyOKX('BTC-USDT-SWAP'));
  results.push(await verifyOKX('ETH-USDT-SWAP'));

  // Generate report
  generateReport(results);

  await closePool();
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('Verification complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}

export { verifyBinance, verifyHyperliquid, verifyBybit, verifyOKX };
