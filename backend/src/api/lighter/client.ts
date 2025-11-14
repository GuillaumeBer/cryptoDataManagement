import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import {
  LighterAsset,
  LighterFundingRate,
  FetchedFundingData,
} from './types';

export class LighterClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Lighter API base URL - update this when official endpoint is confirmed
    this.baseURL = process.env.LIGHTER_API_URL || 'https://api.lighter.xyz';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Lighter API client initialized', { baseURL: this.baseURL });
  }

  /**
   * Fetch all available perpetual futures assets from Lighter
   */
  async getAssets(): Promise<LighterAsset[]> {
    try {
      logger.info('Fetching assets from Lighter');

      // TODO: Update this endpoint based on official Lighter API documentation
      // This is a placeholder implementation
      const response = await this.client.get<{ symbols: LighterAsset[] }>('/api/v1/exchangeInfo');

      const assets = response.data.symbols.filter(
        (s) => s.status === 'TRADING'
      );

      logger.info(`Fetched ${assets.length} assets from Lighter`);
      return assets;
    } catch (error) {
      logger.error('Failed to fetch assets from Lighter', error);
      throw new Error(`Failed to fetch assets: ${error}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   * Lighter uses hourly funding rates with range [-0.5%, +0.5%]
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol}`);

      // Calculate startTime: last 20 days (480 hours)
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);

      // TODO: Update this endpoint based on official Lighter API documentation
      // Endpoint reference: https://apidocs.lighter.xyz/reference/funding-rates
      const response = await this.client.get<LighterFundingRate[]>('/api/v1/funding-rates', {
        params: {
          symbol,
          startTime,
          limit: 1000,
        },
      });

      const fundingData = response.data;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${symbol}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: symbol,
        timestamp: new Date(point.fundingTime),
        fundingRate: point.fundingRate,
        premium: '0', // Lighter doesn't provide separate premium data
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error(`Failed to fetch funding history for ${symbol}:`, errorDetails);
      logger.error(`Failed to fetch funding history for ${symbol}: ${errorDetails}`);
      throw new Error(`Failed to fetch funding history for ${symbol}: ${errorDetails}`);
    }
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 100,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Lighter`);

    let processed = 0;
    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol} from Lighter...`);
        const data = await this.getFundingHistory(symbol);
        results.set(symbol, data);
        console.log(`[API] ✓ ${symbol}: ${data.length} records`);

        processed++;
        // Emit progress callback
        if (onProgress) {
          onProgress(symbol, processed);
        }

        // Add delay to avoid rate limiting
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        console.log(`[API] ✗ ${symbol}: FAILED`);
        logger.error(`Failed to fetch funding history for ${symbol}`, error);
        results.set(symbol, []);
        processed++;
        if (onProgress) {
          onProgress(symbol, processed);
        }
      }
    }

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from Lighter`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default LighterClient;
