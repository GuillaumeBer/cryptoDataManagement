import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import {
  AsterAsset,
  AsterFundingRate,
  FetchedFundingData,
} from './types';

export class AsterClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Aster API base URL - update this when official endpoint is confirmed
    this.baseURL = process.env.ASTER_API_URL || 'https://api.asterdex.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Aster API client initialized', { baseURL: this.baseURL });
  }

  /**
   * Fetch all available perpetual futures assets from Aster
   */
  async getAssets(): Promise<AsterAsset[]> {
    try {
      logger.info('Fetching assets from Aster');

      // TODO: Update this endpoint based on official Aster API documentation
      // Reference: https://docs.asterdex.com/product/aster-perpetual-pro/api/api-documentation
      const response = await this.client.get<{ symbols: AsterAsset[] }>('/api/v1/exchangeInfo');

      const assets = response.data.symbols.filter(
        (s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL'
      );

      logger.info(`Fetched ${assets.length} assets from Aster`);
      return assets;
    } catch (error) {
      logger.error('Failed to fetch assets from Aster', error);
      throw new Error(`Failed to fetch assets: ${error}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   * Aster uses startTime/endTime parameters and returns data in ascending order
   * Fixed interest rate: 0.03% per day
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol}`);

      // Calculate time range: last 20 days
      const endTime = Date.now();
      const startTime = endTime - (20 * 24 * 60 * 60 * 1000);

      // TODO: Update this endpoint based on official Aster API documentation
      // According to docs: startTime and endTime are inclusive
      // If number of data between startTime and endTime is larger than limit,
      // it returns data starting from startTime + limit
      const response = await this.client.get<AsterFundingRate[]>('/api/v1/fundingRate', {
        params: {
          symbol,
          startTime,
          endTime,
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
        premium: '0', // Aster doesn't provide separate premium data
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
   * Aster enforces rate limits with 429 errors
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 200, // Higher delay due to potential rate limits
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Aster`);

    let processed = 0;
    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol} from Aster...`);
        const data = await this.getFundingHistory(symbol);
        results.set(symbol, data);
        console.log(`[API] ✓ ${symbol}: ${data.length} records`);

        processed++;
        // Emit progress callback
        if (onProgress) {
          onProgress(symbol, processed);
        }

        // Add delay to avoid rate limiting (429 errors)
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Aster`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default AsterClient;
