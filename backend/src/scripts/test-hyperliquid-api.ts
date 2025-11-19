import axios from 'axios';
import { logger } from '../utils/logger';

async function testHyperliquidAPI() {
  try {
    logger.info('Testing raw Hyperliquid API...');

    const client = axios.create({
      baseURL: 'https://api.hyperliquid.xyz',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Test metaAndAssetCtxs endpoint
    logger.info('Calling /info with type: metaAndAssetCtxs');
    const response = await client.post('/info', {
      type: 'metaAndAssetCtxs',
    });

    logger.info('Response status:', response.status);
    logger.info('Response is array?', Array.isArray(response.data));
    logger.info('Response data:', JSON.stringify(response.data, null, 2).substring(0, 2000));

    if (Array.isArray(response.data)) {
      logger.info(`Response array length: ${response.data.length}`);
      response.data.forEach((item: any, index: number) => {
        logger.info(`Array item [${index}]:`, typeof item, Array.isArray(item) ? `array length ${item.length}` : Object.keys(item || {}));
      });

      // Check if this matches the expected structure [meta, assetCtxs]
      if (response.data.length === 2 && Array.isArray(response.data[1])) {
        logger.info('Found expected structure: [meta, assetCtxs]');
        logger.info(`assetCtxs length: ${response.data[1].length}`);
        if (response.data[1].length > 0) {
          console.log('First assetCtx:', JSON.stringify(response.data[1][0], null, 2));
          console.log('First assetCtx keys:', Object.keys(response.data[1][0]));
        }
      }
    }

  } catch (error: any) {
    logger.error('Error:', error.message);
    if (error.response) {
      logger.error('Response status:', error.response.status);
      logger.error('Response data:', error.response.data);
    }
  }
}

testHyperliquidAPI().then(() => process.exit(0)).catch(() => process.exit(1));
