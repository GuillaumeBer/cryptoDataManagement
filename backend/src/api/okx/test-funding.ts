import 'dotenv/config';
import OKXClient from './client';
import { logger } from '../../utils/logger';

async function testOKXFunding() {
  const client = new OKXClient();

  try {
    logger.info('Testing OKX funding rate fetch...');

    // Test with a single popular asset
    const instId = 'BTC-USDT-SWAP';
    logger.info(`Fetching funding history for ${instId}`);

    const data = await client.getFundingHistory(instId);

    logger.info(`Received ${data.length} funding rate records`);

    if (data.length > 0) {
      logger.info('Sample records:');
      logger.info('First record:', JSON.stringify(data[0], null, 2));
      logger.info('Last record:', JSON.stringify(data[data.length - 1], null, 2));
    } else {
      logger.warn('No data received! Check the logs above for API response details');
    }

  } catch (error) {
    logger.error('Test failed:', error);
    throw error;
  }
}

if (require.main === module) {
  testOKXFunding()
    .then(() => {
      logger.info('✓ Test completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('✗ Test failed:', error);
      process.exit(1);
    });
}

export default testOKXFunding;
