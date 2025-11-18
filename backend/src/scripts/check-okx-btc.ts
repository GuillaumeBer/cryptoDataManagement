#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';
import { normalizeSymbol } from '../utils/symbolNormalization';

async function checkOkxBtcAssets() {
  // Check if OKX assets are active
  const result = await query(
    `SELECT id, symbol, platform, is_active
     FROM assets
     WHERE platform = 'okx' AND symbol LIKE 'BTC%'
     ORDER BY symbol`
  );

  console.log('OKX BTC assets:');
  console.log(JSON.stringify(result.rows, null, 2));

  // Check normalized symbol for BTC-USDT-SWAP
  const normalizedWithPlatform = normalizeSymbol('BTC-USDT-SWAP', 'okx');
  const normalizedWithoutPlatform = normalizeSymbol('BTC-USDT-SWAP');

  console.log(`\nNormalized 'BTC-USDT-SWAP' with platform 'okx': '${normalizedWithPlatform}'`);
  console.log(`Normalized 'BTC-USDT-SWAP' without platform: '${normalizedWithoutPlatform}'`);

  // Check all OKX assets to see if they're being normalized correctly
  const allOkxResult = await query(
    `SELECT id, symbol, platform, is_active
     FROM assets
     WHERE platform = 'okx' AND is_active = true
     LIMIT 10`
  );

  console.log('\n\nFirst 10 active OKX assets:');
  for (const asset of allOkxResult.rows) {
    const norm = normalizeSymbol(asset.symbol, 'okx');
    console.log(`${asset.symbol} -> ${norm}`);
  }

  process.exit(0);
}

checkOkxBtcAssets().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
