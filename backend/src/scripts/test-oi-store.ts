import dotenv from 'dotenv';
dotenv.config();

import { HyperliquidClient } from '../api/hyperliquid/client';
import AssetRepository from '../models/AssetRepository';
import OpenInterestRepository from '../models/OpenInterestRepository';
import { logger } from '../utils/logger';
import type { CreateOpenInterestParams } from '../models/types';

async function testOIStore() {
  try {
    logger.info('Testing Open Interest storage...');

    const client = new HyperliquidClient();

    // Get a few test assets
    const testSymbols = ['BTC', 'ETH', 'SOL'];
    logger.info(`Fetching OI for ${testSymbols.join(', ')}...`);

    const snapshot = await client.getOpenInterestSnapshot();

    // Get asset IDs from database
    const assets = await AssetRepository.findByPlatform('hyperliquid');
    const assetMap = new Map(assets.map(a => [a.symbol, a.id]));

    const records: CreateOpenInterestParams[] = [];
    for (const symbol of testSymbols) {
      const oiData = snapshot.get(symbol);
      const assetId = assetMap.get(symbol);

      if (!oiData || !assetId) {
        logger.warn(`Skipping ${symbol}: ${!oiData ? 'no OI data' : 'no asset ID'}`);
        continue;
      }

      records.push({
        asset_id: assetId,
        timestamp: oiData.timestamp,
        timeframe: '1h',
        open_interest: oiData.openInterest,
        open_interest_value: oiData.openInterestValue,
        platform: 'hyperliquid',
      });

      logger.info(`${symbol}: Asset ID=${assetId}, OI=${oiData.openInterest}`);
    }

    logger.info(`Storing ${records.length} OI records...`);
    const inserted = await OpenInterestRepository.bulkInsert(records);
    logger.info(`[OK] Stored ${inserted} OI records successfully`);

    // Verify by querying back
    logger.info('\nVerifying stored data...');
    for (const symbol of testSymbols) {
      const assetId = assetMap.get(symbol);
      if (!assetId) continue;

      const stored = await OpenInterestRepository.find({
        assetId,
        platform: 'hyperliquid',
        limit: 1,
      });

      if (stored.length > 0) {
        logger.info(`${symbol}: Verified - OI=${stored[0].open_interest}`);
      } else {
        logger.warn(`${symbol}: No data found in database`);
      }
    }

    logger.info('\n[OK] Open Interest storage test completed successfully');
  } catch (error) {
    logger.error('[ERROR] Open Interest storage test failed:', error);
    throw error;
  }
}

testOIStore()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
