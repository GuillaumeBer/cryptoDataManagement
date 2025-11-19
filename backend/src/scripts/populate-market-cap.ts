#!/usr/bin/env node
import 'dotenv/config';
import { query } from '../database/connection';
import { CoinGeckoClient } from '../api/coingecko/client';
import { logger } from '../utils/logger';

interface UnifiedAssetRow {
  id: number;
  normalized_symbol: string;
  coingecko_id: string | null;
  market_cap_usd: number | null;
}

async function populateMarketCap() {
  logger.info('========================================');
  logger.info('Populating Missing Market Cap Data');
  logger.info('========================================');

  const coingeckoClient = new CoinGeckoClient();

  // Get all unified assets with coingecko_id but missing market cap
  const result = await query<UnifiedAssetRow>(
    `SELECT id, normalized_symbol, coingecko_id, market_cap_usd
     FROM unified_assets
     WHERE coingecko_id IS NOT NULL
     ORDER BY normalized_symbol`
  );

  const assets = result.rows;
  const missingMarketCap = assets.filter(a => !a.market_cap_usd);

  logger.info(`Total unified assets with CoinGecko ID: ${assets.length}`);
  logger.info(`Assets with market cap: ${assets.length - missingMarketCap.length}`);
  logger.info(`Assets missing market cap: ${missingMarketCap.length}`);

  if (missingMarketCap.length === 0) {
    logger.info('All assets already have market cap data!');
    return;
  }

  logger.info('----------------------------------------');
  logger.info('Fetching market cap data from CoinGecko...');

  // Fetch market data in batches (CoinGecko returns 250 coins per page)
  const allMarketData = new Map<string, number>();

  try {
    // Fetch multiple pages to get more coins (top 1000)
    for (let page = 1; page <= 4; page++) {
      logger.info(`Fetching page ${page}...`);
      const marketData = await coingeckoClient.getMarketData(250, page);

      for (const coin of marketData) {
        allMarketData.set(coin.id, coin.market_cap);
      }

      logger.info(`Loaded ${marketData.length} coins from page ${page}`);
    }

    logger.info(`Total market data loaded: ${allMarketData.size} coins`);
  } catch (error) {
    logger.error('Error fetching market data:', error);
    throw error;
  }

  logger.info('----------------------------------------');
  logger.info('Updating database...');

  let updated = 0;
  let notFound = 0;
  const notFoundAssets: UnifiedAssetRow[] = [];

  for (const asset of assets) {
    if (!asset.coingecko_id) continue;

    const marketCap = allMarketData.get(asset.coingecko_id);

    if (marketCap !== undefined) {
      // Update the market cap
      await query(
        `UPDATE unified_assets
         SET market_cap_usd = $1, updated_at = NOW()
         WHERE id = $2`,
        [marketCap, asset.id]
      );

      logger.info(
        `[OK] ${asset.normalized_symbol}: $${marketCap.toLocaleString()}`
      );
      updated++;
    } else {
      notFoundAssets.push(asset);
    }
  }

  // Fetch individual coin details for assets not in top 1000
  if (notFoundAssets.length > 0) {
    logger.info('----------------------------------------');
    logger.info(`Fetching individual coin details for ${notFoundAssets.length} assets not in top 1000...`);

    for (const asset of notFoundAssets) {
      if (!asset.coingecko_id) continue;

      try {
        logger.info(`Fetching details for ${asset.normalized_symbol} (${asset.coingecko_id})...`);
        const coinDetails = await coingeckoClient.getCoinDetails(asset.coingecko_id);

        if (coinDetails?.market_data?.market_cap?.usd) {
          const marketCap = coinDetails.market_data.market_cap.usd;

          await query(
            `UPDATE unified_assets
             SET market_cap_usd = $1, updated_at = NOW()
             WHERE id = $2`,
            [marketCap, asset.id]
          );

          logger.info(
            `[OK] ${asset.normalized_symbol}: $${marketCap.toLocaleString()}`
          );
          updated++;
        } else {
          logger.warn(`[WARN] ${asset.normalized_symbol}: no market cap in coin details`);
          notFound++;
        }
      } catch (error: any) {
        logger.error(`[ERROR] ${asset.normalized_symbol}: ${error.message}`);
        notFound++;
      }
    }
  }

  logger.info('========================================');
  logger.info(`Summary:`);
  logger.info(`  Updated: ${updated}`);
  logger.info(`  Not found: ${notFound}`);
  logger.info('========================================');

  process.exit(0);
}

populateMarketCap().catch((error) => {
  logger.error('Failed to populate market cap:', error);
  process.exit(1);
});
