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
import { logger } from '../utils/logger';

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
  logger.info(`\n[BINANCE] Verifying ${asset}...`);
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

    logger.info(`  API returned ${apiData.length} data points`);

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

    logger.info(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0]; // Repository returns DESC order

    logger.info(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    logger.info(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

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
  logger.info(`\n[HYPERLIQUID] Verifying ${asset}...`);
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

    logger.info(`  API returned ${apiData.length} data points`);

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

    logger.info(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0];

    logger.info(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    logger.info(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

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
  logger.info(`\n[BYBIT] Verifying ${asset}...`);
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

    logger.info(`  API returned ${apiData.length} data points`);

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

    logger.info(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0];

    logger.info(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    logger.info(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

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
  logger.info(`\n[OKX] Verifying ${asset}...`);
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

    logger.info(`  API returned ${apiData.length} data points`);

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

    logger.info(`  DB returned ${dbData.length} data points`);

    if (apiData.length === 0 || dbData.length === 0) {
      result.errors.push('No data available for comparison');
      return result;
    }

    // Compare latest funding rate
    const latestApi = apiData[apiData.length - 1];
    const latestDb = dbData[0];

    logger.info(`  Latest API rate: ${latestApi.fundingRate} at ${latestApi.timestamp}`);
    logger.info(`  Latest DB rate:  ${latestDb.funding_rate} at ${latestDb.timestamp}`);

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
  logger.info('\n========================================');
  logger.info('PLATFORM DATA VERIFICATION REPORT');
  logger.info('========================================\n');

  let allPassed = true;

  for (const result of results) {
    const status = result.errors.length === 0 && result.rateMatches && result.timestampMatches ? '✓ PASS' : '✗ FAIL';
    allPassed = allPassed && status === '✓ PASS';

    logger.info(`\n${result.platform.toUpperCase()} - ${result.asset}: ${status}`);
    logger.info(`  Sampling Interval: ${result.samplingInterval}`);
    logger.info(`  API Data Points: ${result.apiDataPoints}`);
    logger.info(`  DB Data Points: ${result.dbDataPoints}`);
    logger.info(`  Rate Match: ${result.rateMatches ? '✓' : '✗'}`);
    logger.info(`  Timestamp Match: ${result.timestampMatches ? '✓' : '✗'}`);

    if (result.sampleRates && result.sampleRates.length > 0) {
      logger.info('\n  Sample Comparisons:');
      result.sampleRates.forEach((sample, idx) => {
        logger.info(`    [${idx}] API: ${sample.api} | DB: ${sample.db} | ${sample.match ? '✓' : '✗'}`);
      });
    }

    if (result.errors.length > 0) {
      logger.error('\n  Errors:');
      result.errors.forEach((err) => logger.error(`    - ${err}`));
    }
  }

  logger.info('\n========================================');
  logger.info(`OVERALL: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  logger.info('========================================\n');
}

/**
 * Main verification function
 */
async function main() {
  logger.info('Starting platform data verification...\n');

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
      logger.info('Verification complete');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Verification failed:', error);
      process.exit(1);
    });
}

export { verifyBinance, verifyHyperliquid, verifyBybit, verifyOKX };
