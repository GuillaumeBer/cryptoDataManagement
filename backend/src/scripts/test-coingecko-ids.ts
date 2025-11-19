#!/usr/bin/env node
import 'dotenv/config';
import { CoinGeckoClient } from '../api/coingecko/client';
import { logger } from '../utils/logger';

async function testCoinGeckoIds() {
  logger.info('Testing CoinGecko API IDs...');

  const client = new CoinGeckoClient();

  // Fetch market data from pages 1-4 (top 1000 coins)
  const allMarketData = new Map<string, { rank: number; marketCap: number }>();

  for (let page = 1; page <= 4; page++) {
    logger.info(`Fetching page ${page}...`);
    const marketData = await client.getMarketData(250, page);

    logger.info(`Page ${page}: ${marketData.length} coins`);

    for (const coin of marketData) {
      allMarketData.set(coin.id, {
        rank: coin.market_cap_rank,
        marketCap: coin.market_cap
      });
    }
  }

  logger.info(`Total coins fetched: ${allMarketData.size}`);
  logger.info('----------------------------------------');

  // Check for specific coins
  const coinsToCheck = ['bitcoin', 'ethereum', 'solana', 'tether', 'binancecoin', 'goat'];

  for (const coinId of coinsToCheck) {
    const data = allMarketData.get(coinId);
    if (data) {
      logger.info(`[OK] ${coinId}: Rank #${data.rank}, Market Cap: $${data.marketCap.toLocaleString()}`);
    } else {
      logger.warn(`[WARN] ${coinId}: NOT FOUND in top 1000`);
    }
  }

  logger.info('----------------------------------------');

  // Show first 10 entries
  logger.info('First 10 entries in market data:');
  let count = 0;
  for (const [id, data] of allMarketData.entries()) {
    if (count++ < 10) {
      logger.info(`  ${id}: Rank #${data.rank}`);
    }
  }

  process.exit(0);
}

testCoinGeckoIds().catch((error) => {
  logger.error('Test failed:', error);
  process.exit(1);
});
