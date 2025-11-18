/**
 * Utility script to backfill Bybit OHLCV candles without running the full initial fetch.
 *
 * Usage:
 *   pnpm tsx src/scripts/fetch-bybit-ohlcv.ts            // fetch all Bybit assets
 *   pnpm tsx src/scripts/fetch-bybit-ohlcv.ts BTCUSDT    // fetch specific assets
 */

import 'dotenv/config';
import { BybitClient } from '../api/bybit/client';
import AssetRepository from '../models/AssetRepository';
import OHLCVRepository from '../models/OHLCVRepository';
import { CreateOHLCVParams } from '../models/types';
import { closePool } from '../database/connection';
import { logger } from '../utils/logger';

async function fetchBybitOHLCV(targetSymbols?: string[]): Promise<void> {
  logger.info('[Bybit OHLCV] Starting backfill task');

  const assets = await AssetRepository.findByPlatform('bybit');
  if (!assets.length) {
    throw new Error('No Bybit assets found in the database. Run the asset sync first.');
  }

  const symbolSet =
    targetSymbols && targetSymbols.length > 0
      ? new Set(targetSymbols.map((s) => s.toUpperCase()))
      : null;

  const symbols = assets
    .map((asset) => asset.symbol)
    .filter((symbol) => (symbolSet ? symbolSet.has(symbol.toUpperCase()) : true));

  if (!symbols.length) {
    throw new Error(
      `Requested symbol list ${targetSymbols?.join(',') ?? ''} is empty or not present in the database`
    );
  }

  logger.info(`[Bybit OHLCV] Fetching ${symbols.length} asset(s)`);

  const client = new BybitClient();
  const ohlcvMap = await client.getOHLCVBatch(
    symbols,
    '60',
    600,
    1,
    (currentSymbol: string, processed: number) => {
      if (processed % 25 === 0 || processed === symbols.length) {
        logger.info(`[Bybit OHLCV] Progress ${processed}/${symbols.length} (${currentSymbol})`);
      }
    }
  );

  let totalInserted = 0;
  for (const [symbol, candles] of ohlcvMap.entries()) {
    if (!candles.length) {
      logger.warn(`[Bybit OHLCV] No candles returned for ${symbol}`);
      continue;
    }

    const asset = assets.find((a) => a.symbol === symbol);
    if (!asset) {
      logger.warn(`[Bybit OHLCV] Asset not found for symbol ${symbol}, skipping storage`);
      continue;
    }

    const records: CreateOHLCVParams[] = candles.map((candle) => ({
      asset_id: asset.id,
      timestamp: candle.timestamp,
      timeframe: '1h',
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      quote_volume: candle.quoteVolume,
      trades_count: candle.tradesCount,
      platform: 'bybit',
    }));

    const inserted = await OHLCVRepository.bulkInsert(records);
    totalInserted += inserted;
    logger.info(`[Bybit OHLCV] Stored ${inserted} candles for ${symbol}`);
  }

  logger.info(`[Bybit OHLCV] Completed backfill. Inserted ${totalInserted} records total.`);
}

async function main() {
  const [, , ...args] = process.argv;
  const symbols = args.length > 0 ? args : undefined;

  try {
    await fetchBybitOHLCV(symbols);
  } catch (error) {
    logger.error('[Bybit OHLCV] Backfill failed', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main();
}
