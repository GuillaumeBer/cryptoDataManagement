import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import {
  BybitInstrument,
  BybitInstrumentsResponse,
  BybitFundingRateHistoryResponse,
  FetchedFundingData,
} from './types';

/**
 * Bybit V5 API Client
 *
 * Documentation: https://bybit-exchange.github.io/docs/v5/intro
 *
 * Funding Rate Information:
 * - Bybit uses 8-hour funding intervals (00:00, 08:00, 16:00 UTC)
 * - Funding rate is settled at these specific times
 * - Historical funding rate data available via /v5/market/funding/history
 *
 * Rate Limits (as of V5 API):
 * - Public endpoints: 50 requests per 2 seconds per IP
 * - Equivalent to ~1500 requests per minute
 * - Conservative delay: 600ms (100 requests/min) to stay well within limits
 */
export class BybitClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Bybit V5 API base URL
    this.baseURL = process.env.BYBIT_API_URL || 'https://api.bybit.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Bybit V5 API client initialized', { baseURL: this.baseURL });
  }

  /**
   * Safely extract error message from axios error
   */
  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data) {
        const data = axiosError.response.data as any;
        return `${axiosError.message}: ${data.retMsg || JSON.stringify(data).substring(0, 200)}`;
      }
      return axiosError.message;
    }
    return String(error);
  }

  /**
   * Fetch all available USDT perpetual contracts from Bybit
   *
   * Endpoint: GET /v5/market/instruments-info
   * Documentation: https://bybit-exchange.github.io/docs/v5/market/instrument
   *
   * Query Parameters:
   * - category: "linear" (for USDT perpetual contracts)
   * - status: "Trading" (optional, to filter active contracts)
   * - limit: max 1000 (default 500)
   *
   * Rate Limit: 50 requests per 2 seconds
   */
  async getAssets(): Promise<BybitInstrument[]> {
    try {
      logger.info('Fetching perpetual contracts from Bybit');

      const response = await this.client.get<BybitInstrumentsResponse>('/v5/market/instruments-info', {
        params: {
          category: 'linear', // USDT perpetual contracts
          limit: 1000, // Get as many as possible in one request
        },
      });

      // Check if request was successful
      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      // Filter for active trading contracts and perpetuals only
      const assets = response.data.result.list.filter(
        (instrument) =>
          instrument.status === 'Trading' &&
          instrument.contractType === 'LinearPerpetual'
      );

      logger.info(`Fetched ${assets.length} active perpetual contracts from Bybit`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Bybit', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   *
   * Endpoint: GET /v5/market/funding/history
   * Documentation: https://bybit-exchange.github.io/docs/v5/market/history-fund-rate
   *
   * Bybit Funding Rate Details:
   * - Funding occurs every 8 hours at 00:00, 08:00, 16:00 UTC
   * - Each funding period is 8 hours (480 minutes)
   * - Historical data: we fetch 480 hours = 60 funding periods
   *
   * Query Parameters:
   * - category: "linear" (required)
   * - symbol: e.g., "BTCUSDT" (required)
   * - startTime: Unix timestamp in milliseconds (optional)
   * - endTime: Unix timestamp in milliseconds (optional)
   * - limit: max 200 records per request (default 200)
   *
   * Rate Limit: 50 requests per 2 seconds
   *
   * Note: If more than 200 records needed, implement pagination
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol} from Bybit`);

      // Calculate time range: 480 hours ago to now
      // This gives us 60 funding periods (8h each)
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const response = await this.client.get<BybitFundingRateHistoryResponse>('/v5/market/funding/history', {
        params: {
          category: 'linear',
          symbol,
          startTime,
          endTime,
          limit: 200, // Maximum allowed per request
        },
      });

      // Check if request was successful
      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      const fundingData = response.data.result.list;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${symbol}`);
        return [];
      }

      // Convert to our standard format
      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: symbol,
        timestamp: new Date(parseInt(point.fundingRateTimestamp)),
        fundingRate: point.fundingRate,
        premium: '0', // Bybit doesn't provide premium separately in this endpoint
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   *
   * Rate Limiting Strategy:
   * - Bybit allows 50 requests per 2 seconds (~1500 req/min)
   * - We use 600ms delay (100 req/min) to be conservative
   * - This ensures we stay well within limits even with concurrent requests
   *
   * @param symbols - Array of symbol strings (e.g., ["BTCUSDT", "ETHUSDT"])
   * @param delayMs - Delay between requests in milliseconds (default: 600ms)
   * @param onProgress - Optional callback for progress tracking
   * @returns Map of symbol to funding data array
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Bybit`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching ${symbol} from Bybit...`);
          const data = await this.getFundingHistory(symbol);
          results.set(symbol, data);
          logger.info(`[API] ✓ ${symbol}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);

          // Store empty array for failed symbols to maintain consistency
          results.set(symbol, []);
        } finally {
          processed++;
          if (onProgress) {
            onProgress(symbol, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from Bybit`);

    return results;
  }
}

export default BybitClient;
