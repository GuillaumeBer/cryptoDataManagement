import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import {
  HyperliquidMetaResponse,
  HyperliquidFundingHistoryResponse,
  HyperliquidAsset,
  FetchedFundingData,
} from './types';

export class HyperliquidClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Hyperliquid API client initialized', { baseURL: this.baseURL });
  }

  /**
   * Fetch all available assets from Hyperliquid
   */
  async getAssets(): Promise<HyperliquidAsset[]> {
    try {
      logger.info('Fetching assets from Hyperliquid');

      const response = await this.client.post<HyperliquidMetaResponse>('/info', {
        type: 'meta',
      });

      const assets = response.data.universe.map((asset) => ({
        name: asset.name,
        maxLeverage: asset.maxLeverage,
      }));

      logger.info(`Fetched ${assets.length} assets from Hyperliquid`);
      return assets;
    } catch (error) {
      logger.error('Failed to fetch assets from Hyperliquid', error);
      throw new Error(`Failed to fetch assets: ${error}`);
    }
  }

  /**
   * Fetch funding rate history for a specific asset
   * Returns last 480 hours of data (max supported by Hyperliquid is 500 hours)
   */
  async getFundingHistory(coin: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${coin}`);

      // Calculate startTime: 480 hours ago in milliseconds
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);

      const response = await this.client.post<HyperliquidFundingHistoryResponse>('/info', {
        type: 'fundingHistory',
        coin,
        startTime,
      });

      const fundingData = response.data;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${coin}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: coin,
        timestamp: new Date(point.time),
        fundingRate: point.fundingRate,
        premium: point.premium,
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${coin}`);
      return results;
    } catch (error: any) {
      const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error(`Failed to fetch funding history for ${coin}:`, errorDetails);
      logger.error(`Failed to fetch funding history for ${coin}: ${errorDetails}`);
      throw new Error(`Failed to fetch funding history for ${coin}: ${errorDetails}`);
    }
  }

  /**
   * Fetch funding history for multiple assets with rate limiting
   */
  async getFundingHistoryBatch(
    coins: string[],
    delayMs: number = 100,
    onProgress?: (currentCoin: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${coins.length} assets`);

    let processed = 0;
    for (const coin of coins) {
      try {
        console.log(`[API] Fetching ${coin}...`);
        const data = await this.getFundingHistory(coin);
        results.set(coin, data);
        console.log(`[API] ✓ ${coin}: ${data.length} records`);

        processed++;
        // Emit progress callback
        if (onProgress) {
          onProgress(coin, processed);
        }

        // Add delay to avoid rate limiting
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        console.log(`[API] ✗ ${coin}: FAILED`);
        logger.error(`Failed to fetch funding history for ${coin}`, error);
        results.set(coin, []);
        processed++;
        if (onProgress) {
          onProgress(coin, processed);
        }
      }
    }

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default HyperliquidClient;
