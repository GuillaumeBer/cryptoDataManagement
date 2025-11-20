#!/usr/bin/env node
/**
 * CLI tool to manually fetch Open Interest snapshots for snapshot-only platforms
 * (Hyperliquid and Aster)
 *
 * Usage:
 *   npm run fetch-oi-snapshot hyperliquid
 *   npm run fetch-oi-snapshot aster
 *   npm run fetch-oi-snapshot hyperliquid --assets BTC,ETH,SOL
 *
 * These platforms only provide current OI snapshots, not historical data.
 * Historical charts build up over time through periodic snapshot fetches.
 */

import 'dotenv/config';
import { HyperliquidClient } from '../api/hyperliquid/client';
import { AsterClient } from '../api/aster/client';
import AssetRepository from '../models/AssetRepository';
import OpenInterestRepository from '../models/OpenInterestRepository';
import { CreateOpenInterestParams } from '../models/types';
import { logger } from '../utils/logger';

const SNAPSHOT_PLATFORMS = ['hyperliquid', 'aster'] as const;
type SnapshotPlatform = typeof SNAPSHOT_PLATFORMS[number];

async function fetchOISnapshot(platform: SnapshotPlatform, specificAssets?: string[]) {
  console.log(`\n=== Fetching OI Snapshot for ${platform.toUpperCase()} ===\n`);

  try {
    // Get assets from database
    const allAssets = await AssetRepository.findByPlatform(platform);
    console.log(`Found ${allAssets.length} ${platform} assets in database`);

    if (allAssets.length === 0) {
      console.log(`⚠️  No ${platform} assets found. Run initial fetch first.`);
      process.exit(1);
    }

    // Filter to specific assets if requested
    let targetAssets = allAssets;
    if (specificAssets && specificAssets.length > 0) {
      targetAssets = allAssets.filter(asset =>
        specificAssets.some(requested => asset.symbol.toUpperCase().includes(requested.toUpperCase()))
      );
      console.log(`Filtering to ${targetAssets.length} requested assets: ${specificAssets.join(', ')}`);
    }

    if (targetAssets.length === 0) {
      console.log(`⚠️  No matching assets found for: ${specificAssets?.join(', ')}`);
      process.exit(1);
    }

    const assetSymbols = targetAssets.map(a => a.symbol);
    const assetMap = new Map(targetAssets.map(asset => [asset.symbol, asset.id]));

    // Fetch OI snapshots
    let oiDataMap: Map<string, any[]>;

    if (platform === 'hyperliquid') {
      console.log(`\nFetching OI snapshots for ${assetSymbols.length} assets from Hyperliquid...`);
      const client = new HyperliquidClient();
      oiDataMap = await client.getOpenInterestBatch(assetSymbols);
    } else if (platform === 'aster') {
      console.log(`\nFetching OI snapshots for ${assetSymbols.length} assets from Aster...`);
      console.log('(This may take a while due to rate limiting: ~700ms per asset)\n');
      const client = new AsterClient();
      oiDataMap = await client.getOpenInterestBatch(assetSymbols, '1h', 700, 1);
    } else {
      console.error(`❌ Unsupported platform: ${platform}`);
      process.exit(1);
    }

    console.log(`\n✓ Fetched OI data for ${oiDataMap.size} assets`);

    // Store OI snapshots in database
    let totalStored = 0;
    let successCount = 0;
    let noDataCount = 0;
    let errorCount = 0;

    for (const [symbol, oiData] of oiDataMap.entries()) {
      const assetId = assetMap.get(symbol);
      if (!assetId) {
        console.log(`⚠️  Asset not found in DB: ${symbol}`);
        errorCount++;
        continue;
      }

      if (oiData.length === 0) {
        console.log(`○ ${symbol}: No OI data available`);
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
          platform,
        }));

        const inserted = await OpenInterestRepository.bulkInsert(records);
        totalStored += inserted;
        successCount++;

        const oiValue = parseFloat(oiData[0].openInterest).toLocaleString();
        console.log(`✓ ${symbol}: ${oiValue} contracts`);
      } catch (error: any) {
        console.error(`✗ ${symbol}: ${error.message}`);
        errorCount++;
      }
    }

    // Summary
    console.log(`\n=== Summary ===`);
    console.log(`✓ Success: ${successCount} assets`);
    console.log(`○ No data: ${noDataCount} assets`);
    console.log(`✗ Errors: ${errorCount} assets`);
    console.log(`📊 Total OI snapshots stored: ${totalStored}`);

    // Verify final count
    const finalCount = await OpenInterestRepository.count(platform, '1h');
    console.log(`\n✅ Total ${platform} OI records in database: ${finalCount}`);

    console.log(`\n💡 Tip: Run this command periodically (hourly/daily) to build historical OI data.`);

    process.exit(0);
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    logger.error('OI snapshot fetch failed', error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const platform = args[0] as SnapshotPlatform;

// Parse --assets flag
let specificAssets: string[] | undefined;
const assetsIndex = args.indexOf('--assets');
if (assetsIndex !== -1 && args[assetsIndex + 1]) {
  specificAssets = args[assetsIndex + 1].split(',').map(s => s.trim());
}

// Validate platform
if (!platform || !SNAPSHOT_PLATFORMS.includes(platform)) {
  console.error(`
❌ Invalid or missing platform argument

Usage:
  npm run fetch-oi-snapshot <platform> [--assets ASSET1,ASSET2,...]

Supported platforms:
  - hyperliquid (fetches all assets in one API call)
  - aster       (fetches one asset at a time, rate-limited)

Examples:
  npm run fetch-oi-snapshot hyperliquid
  npm run fetch-oi-snapshot aster --assets BTC,ETH,SOL
  npm run fetch-oi-snapshot hyperliquid --assets BTC

Note: These platforms only support OI snapshots (not historical data).
Historical charts build up over time through periodic snapshot fetches.
  `);
  process.exit(1);
}

// Run the snapshot fetch
fetchOISnapshot(platform, specificAssets);
