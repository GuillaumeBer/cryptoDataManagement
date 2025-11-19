#!/usr/bin/env node
import 'dotenv/config';
import { CoinGeckoClient } from '../api/coingecko/client';
import { logger } from '../utils/logger';

async function testGoat() {
  logger.info('Testing GOAT coin fetch...');

  const client = new CoinGeckoClient();

  try {
    logger.info('Fetching coin details for "goat"...');
    const coinDetails = await client.getCoinDetails('goat');

    logger.info('Success! Coin details:');
    logger.info(`  ID: ${coinDetails.id}`);
    logger.info(`  Name: ${coinDetails.name}`);
    logger.info(`  Symbol: ${coinDetails.symbol}`);
    logger.info(`  Market Cap Rank: ${coinDetails.market_cap_rank || 'N/A'}`);

    if (coinDetails.market_data) {
      const marketCap = coinDetails.market_data.market_cap?.usd;
      logger.info(`  Market Cap USD: ${marketCap ? `$${marketCap.toLocaleString()}` : 'N/A'}`);
    } else {
      logger.warn('  No market data available');
    }
  } catch (error: any) {
    logger.error(`Error fetching GOAT: ${error.message}`);
    if (error.response?.status) {
      logger.error(`  HTTP Status: ${error.response.status}`);
      logger.error(`  Response: ${JSON.stringify(error.response.data)}`);
    }
  }

  process.exit(0);
}

testGoat().catch((error) => {
  logger.error('Test failed:', error);
  process.exit(1);
});
