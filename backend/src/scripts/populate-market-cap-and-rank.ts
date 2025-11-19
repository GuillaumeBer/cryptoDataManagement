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
  market_cap_rank: number | null;
}

async function populateMarketCapAndRank() {
  logger.info('========================================');
  logger.info('Populating Market Cap & Rank Data');
  logger.info('========================================');

  const coingeckoClient = new CoinGeckoClient();

  // Get all unified assets with coingecko_id
  const result = await query<UnifiedAssetRow>(
    `SELECT id, normalized_symbol, coingecko_id, market_cap_usd, market_cap_rank
     FROM unified_assets
     WHERE coingecko_id IS NOT NULL
     ORDER BY normalized_symbol`
  );

  const assets = result.rows;

  logger.info(`Total unified assets with CoinGecko ID: ${assets.length}`);
  logger.info(`Assets with market cap: ${assets.filter(a => a.market_cap_usd).length}`);
  logger.info(`Assets with rank: ${assets.filter(a => a.market_cap_rank).length}`);

  logger.info('----------------------------------------');
  logger.info('Fetching market cap data from CoinGecko (top 1000)...');

  // Fetch market data in batches (CoinGecko returns 250 coins per page)
  const allMarketData = new Map<string, { market_cap: number; rank: number }>();

  try {
    // Fetch multiple pages to get top 1000 coins
    for (let page = 1; page <= 4; page++) {
      logger.info(`Fetching page ${page}...`);
      const marketData = await coingeckoClient.getMarketData(250, page);

      for (const coin of marketData) {
        allMarketData.set(coin.id, {
          market_cap: coin.market_cap,
          rank: coin.market_cap_rank || ((page - 1) * 250 + marketData.indexOf(coin) + 1)
        });
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

    const data = allMarketData.get(asset.coingecko_id);

    if (data) {
      // Update market cap and rank
      await query(
        `UPDATE unified_assets
         SET market_cap_usd = $1, market_cap_rank = $2, updated_at = NOW()
         WHERE id = $3`,
        [data.market_cap, data.rank, asset.id]
      );

      logger.info(
        `[OK] ${asset.normalized_symbol}: $${data.market_cap.toLocaleString()} (Rank #${data.rank})`
      );
      updated++;
    } else {
      notFoundAssets.push(asset);
    }
  }

  // Fetch individual coin details for assets not in top 1000 (with rate limiting)
  if (notFoundAssets.length > 0) {
    logger.info('----------------------------------------');
    logger.info(`Fetching individual coin details for ${notFoundAssets.length} assets not in top 1000...`);
    logger.info('Using strict rate limiting (2s delay between requests) to avoid API limits');

    for (let i = 0; i < notFoundAssets.length; i++) {
      const asset = notFoundAssets[i];
      if (!asset.coingecko_id) continue;

      try {
        logger.info(`[${i + 1}/${notFoundAssets.length}] Fetching ${asset.normalized_symbol} (${asset.coingecko_id})...`);

        const coinDetails = await coingeckoClient.getCoinDetails(asset.coingecko_id);

        if (coinDetails?.market_data?.market_cap?.usd) {
          const marketCap = coinDetails.market_data.market_cap.usd;
          const rank = coinDetails.market_cap_rank || null;

          await query(
            `UPDATE unified_assets
             SET market_cap_usd = $1, market_cap_rank = $2, updated_at = NOW()
             WHERE id = $3`,
            [marketCap, rank, asset.id]
          );

          const rankStr = rank ? ` (Rank #${rank})` : '';
          logger.info(
            `[OK] ${asset.normalized_symbol}: $${marketCap.toLocaleString()}${rankStr}`
          );
          updated++;
        } else {
          logger.warn(`[WARN] ${asset.normalized_symbol}: no market cap in coin details`);
          notFound++;
        }
      } catch (error: any) {
        if (error.response?.status === 429) {
          logger.error(`[WARN] ${asset.normalized_symbol}: Rate limit hit - waiting 10 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          // Retry this asset
          i--;
        } else {
          logger.error(`[ERROR] ${asset.normalized_symbol}: ${error.message}`);
          notFound++;
        }
      }

      // Add 2-second delay between requests to avoid rate limits
      if (i < notFoundAssets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
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

populateMarketCapAndRank().catch((error) => {
  logger.error('Failed to populate market cap and rank:', error);
  process.exit(1);
});
