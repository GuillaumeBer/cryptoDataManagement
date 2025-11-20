import 'dotenv/config';
import BinanceClient from './src/api/binance/client';
import AssetRepository from './src/models/AssetRepository';
import OpenInterestRepository from './src/models/OpenInterestRepository';
import { CreateOpenInterestParams } from './src/models/types';
import { logger } from './src/utils/logger';

async function fetchBinanceOI() {
  try {
    logger.info('Starting Binance OI data fetch');

    // Get all Binance assets
    const assets = await AssetRepository.findByPlatform('binance');
    logger.info(`Found ${assets.length} Binance assets`);

    if (assets.length === 0) {
      logger.error('No Binance assets found. Run initial fetch first.');
      process.exit(1);
    }

    const client = new BinanceClient();
    const assetSymbols = assets.map(a => a.symbol);

    // Fetch OI data for all assets
    logger.info(`Fetching OI data for ${assetSymbols.length} assets...`);
    const oiDataMap = await client.getOpenInterestBatch(
      assetSymbols,
      '1h',
      700,  // 700ms delay between requests
      1,    // 1 concurrent request
      (currentSymbol: string, processed: number) => {
        logger.info(`[${processed}/${assetSymbols.length}] Processed ${currentSymbol}`);
      }
    );

    // Build symbol -> assetId map
    const assetMap = new Map(assets.map(asset => [asset.symbol, asset.id]));

    // Store OI data
    let totalInserted = 0;
    let totalFetched = 0;
    let processedCount = 0;

    for (const [symbol, oiData] of oiDataMap.entries()) {
      try {
        const assetId = assetMap.get(symbol);
        if (!assetId) {
          logger.warn(`Asset not found for symbol: ${symbol}`);
          continue;
        }

        if (oiData.length === 0) {
          logger.debug(`No OI data for ${symbol}`);
          processedCount++;
          continue;
        }

        const records: CreateOpenInterestParams[] = oiData.map(data => ({
          asset_id: assetId,
          timestamp: data.timestamp,
          timeframe: '1h',
          open_interest: data.openInterest,
          open_interest_value: data.openInterestValue,
          platform: 'binance',
        }));

        const inserted = await OpenInterestRepository.bulkInsert(records);
        totalInserted += inserted;
        totalFetched += oiData.length;
        processedCount++;

        logger.info(`[${processedCount}/${assetSymbols.length}] Stored ${inserted} OI records for ${symbol} (fetched ${oiData.length})`);
      } catch (error) {
        logger.error(`Failed to store OI data for ${symbol}:`, error);
      }
    }

    logger.info(`
=== Binance OI Fetch Complete ===
Total assets processed: ${processedCount}/${assetSymbols.length}
Total records fetched: ${totalFetched}
Total records inserted: ${totalInserted}
    `);

    process.exit(0);
  } catch (error) {
    logger.error('Error:', error);
    process.exit(1);
  }
}

fetchBinanceOI();
