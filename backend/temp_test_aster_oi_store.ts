import 'dotenv/config';
import { AsterClient } from './src/api/aster/client';
import AssetRepository from './src/models/AssetRepository';
import OpenInterestRepository from './src/models/OpenInterestRepository';
import { CreateOpenInterestParams } from './src/models/types';

async function testAsterOIStore() {
  try {
    console.log('\n=== Testing Aster OI Storage ===\n');

    const client = new AsterClient();
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

    // Fetch OI data
    console.log('Fetching OI data for:', symbols.join(', '));
    const oiDataMap = await client.getOpenInterestBatch(symbols, '1h', 500, 1);

    console.log(`\nFetched OI data for ${oiDataMap.size} assets`);

    // Get asset IDs from database
    const assets = await AssetRepository.findByPlatform('aster');
    const assetMap = new Map(assets.map((asset) => [asset.symbol, asset.id]));

    console.log(`\nFound ${assets.length} Aster assets in database`);

    // Store OI data
    let totalStored = 0;
    for (const [symbol, oiData] of oiDataMap.entries()) {
      const assetId = assetMap.get(symbol);
      if (!assetId) {
        console.log(`⚠️  Asset not found in database: ${symbol}`);
        continue;
      }

      if (oiData.length === 0) {
        console.log(`○ ${symbol}: No OI data available`);
        continue;
      }

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
      console.log(`✓ ${symbol}: Stored ${inserted} OI record(s) - OI=${oiData[0].openInterest}`);
    }

    console.log(`\n✅ Total OI records stored: ${totalStored}`);

    // Verify data in database
    console.log('\n=== Verifying Database ===\n');
    const dbAssets = await AssetRepository.findByPlatform('aster');
    for (const asset of dbAssets.slice(0, 3)) {
      const oiRecords = await OpenInterestRepository.findByAssetAndPlatform(
        asset.id,
        'aster',
        '1h',
        new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        new Date()
      );
      console.log(`${asset.symbol}: ${oiRecords.length} OI records in DB`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testAsterOIStore();
