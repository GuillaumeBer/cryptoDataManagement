import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  BybitSymbol,
  BybitExchangeInfo,
  BybitFundingRateResponse,
  FetchedFundingData,
} from './types';

export class BybitClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Bybit API base URL
    // Documentation: https://bybit-exchange.github.io/docs/v5/intro
    this.baseURL = process.env.BYBIT_API_URL || 'https://api.bybit.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Bybit API client initialized', { baseURL: this.baseURL });
  }

  /**
   * Safely extract error message from axios error
   */
  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      return axiosError.response?.data
        ? `${axiosError.message}: ${JSON.stringify(axiosError.response.data).substring(0, 200)}`
        : axiosError.message;
    }
    return String(error);
  }

  /**
   * Fetch all available perpetual futures from Bybit
   * Endpoint: GET /v5/market/instruments-info
   *
   * TODO: Implement based on Bybit API documentation
   * - category: 'linear' for USDT perpetuals
   * - Filter for active trading pairs
   */
  async getAssets(): Promise<BybitSymbol[]> {
    try {
      logger.info('Fetching assets from Bybit');

      // TODO: Replace with actual Bybit endpoint
      // Example: GET /v5/market/instruments-info?category=linear
      const response = await this.client.get<BybitExchangeInfo>('/v5/market/instruments-info', {
        params: {
          category: 'linear', // USDT perpetuals
        },
      });

      // TODO: Adjust filtering based on actual response structure
      const assets = response.data.result.list.filter(
        (s) => s.status === 'Trading'
      );

      logger.info(`Fetched ${assets.length} perpetual assets from Bybit`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Bybit', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   * Endpoint: GET /v5/market/funding/history
   *
   * Bybit Futures funding happens every 8 hours (00:00, 08:00, 16:00 UTC)
   *
   * TODO: Verify API endpoint and parameters from official documentation
   * - Bybit uses symbol format like "BTCUSDT"
   * - Historical depth: 480 hours (60 funding periods at 8h intervals)
   *
   * Rate Limits:
   * - TODO: Add actual rate limits from Bybit documentation
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol} from Bybit`);

      // Calculate time range: 480 hours ago
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      // TODO: Replace with actual Bybit endpoint
      // Example: GET /v5/market/funding/history
      const response = await this.client.get<BybitFundingRateResponse>('/v5/market/funding/history', {
        params: {
          category: 'linear',
          symbol,
          startTime,
          endTime,
          limit: 200, // TODO: Verify max limit
        },
      });

      const fundingData = response.data.result.list;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${symbol}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: symbol,
        timestamp: new Date(parseInt(point.fundingRateTimestamp)),
        fundingRate: point.fundingRate,
        premium: '0', // TODO: Check if Bybit provides premium separately
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      console.error(`Failed to fetch funding history for ${symbol}:`, errorMsg);
      logger.error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   *
   * TODO: Add actual Bybit rate limits
   * - Default delay: 600ms (placeholder, adjust based on actual limits)
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 600,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Bybit`);

    let processed = 0;
    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol} from Bybit...`);
        const data = await this.getFundingHistory(symbol);
        results.set(symbol, data);
        console.log(`[API] ✓ ${symbol}: ${data.length} records`);

        processed++;
        if (onProgress) {
          onProgress(symbol, processed);
        }

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Bybit`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default BybitClient;
