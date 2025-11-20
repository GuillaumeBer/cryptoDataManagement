import 'dotenv/config';
import { AsterClient } from './src/api/aster/client';
import AssetRepository from './src/models/AssetRepository';
import OpenInterestRepository from './src/models/OpenInterestRepository';
import { CreateOpenInterestParams } from './src/models/types';
import { logger } from './src/utils/logger';

async function fetchAllAsterOI() {
  try {
    console.log('\n=== Fetching OI Data for All Aster Assets ===\n');

    // Get all Aster assets from database
    const assets = await AssetRepository.findByPlatform('aster');
    console.log(`Found ${assets.length} Aster assets in database`);

    if (assets.length === 0) {
      console.log('⚠️  No Aster assets found. Run initial fetch first.');
      process.exit(1);
    }

    const symbols = assets.map((a) => a.symbol);
    const assetMap = new Map(assets.map((asset) => [asset.symbol, asset.id]));

    // Fetch OI data from Aster API (limited batch for testing)
    const client = new AsterClient();
    console.log(`\nFetching OI snapshots for ${symbols.length} assets...`);
    console.log('(This will take a while due to rate limiting)\n');

    const oiDataMap = await client.getOpenInterestBatch(
      symbols,
      '1h',
      700, // 700ms delay
      1    // Concurrency 1 to be safe
    );

    console.log(`\n✓ Fetched OI data for ${oiDataMap.size} assets`);

    // Store OI data in database
    let totalStored = 0;
    let successCount = 0;
    let noDataCount = 0;
    let errorCount = 0;

    for (const [symbol, oiData] of oiDataMap.entries()) {
      const assetId = assetMap.get(symbol);
      if (!assetId) {
        errorCount++;
        continue;
      }

      if (oiData.length === 0) {
        noDataCount++;
        continue;
      }

      try {
        const records: CreateOpenInterestParams[] = oiData.map((data) => ({
          asset_id: assetId,
          timestamp: data.timestamp,
          timeframe: '1h',
          open_interest: data.openInterest,
          open_interest_value: data.openInterestValue,
          platform: 'aster',
        }));

        const inserted = await OpenInterestRepository.bulkInsert(records);
        totalStored += inserted;
        successCount++;
      } catch (error) {
        logger.error(`Failed to store OI for ${symbol}:`, error);
        errorCount++;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`✓ Success: ${successCount} assets`);
    console.log(`○ No data: ${noDataCount} assets`);
    console.log(`✗ Errors: ${errorCount} assets`);
    console.log(`📊 Total OI records stored: ${totalStored}`);

    // Verify final count in database
    const finalCount = await OpenInterestRepository.count('aster', '1h');
    console.log(`\n✅ Total Aster OI records in database: ${finalCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fetchAllAsterOI();
