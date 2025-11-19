import { HyperliquidClient } from '../api/hyperliquid/client';
import { logger } from '../utils/logger';

async function testOIFetch() {
  try {
    logger.info('Testing Hyperliquid Open Interest fetch...');

    const client = new HyperliquidClient();

    // Test 1: Get OI snapshot
    logger.info('Test 1: Getting OI snapshot...');
    const snapshot = await client.getOpenInterestSnapshot();
    logger.info(`Snapshot size: ${snapshot.size} assets`);

    // Display first 5 assets
    let count = 0;
    for (const [symbol, data] of snapshot.entries()) {
      if (count++ >= 5) break;
      logger.info(`${symbol}: OI=${data.openInterest}, Value=${data.openInterestValue || 'N/A'}, Time=${data.timestamp}`);
    }

    // Test 2: Get batch OI for specific assets
    logger.info('\nTest 2: Getting batch OI for BTC, ETH, SOL...');
    const testAssets = ['BTC', 'ETH', 'SOL'];
    const batchResult = await client.getOpenInterestBatch(testAssets);

    for (const [symbol, records] of batchResult.entries()) {
      logger.info(`${symbol}: ${records.length} records`);
      if (records.length > 0) {
        const latest = records[records.length - 1];
        logger.info(`  Latest: OI=${latest.openInterest}, Value=${latest.openInterestValue || 'N/A'}`);
      }
    }

    logger.info('\n[OK] Open Interest fetch test completed successfully');
  } catch (error) {
    logger.error('[ERROR] Open Interest fetch test failed:', error);
    throw error;
  }
}

testOIFetch()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
