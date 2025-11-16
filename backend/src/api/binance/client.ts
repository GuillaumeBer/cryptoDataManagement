import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import {
  BinanceAsset,
  BinanceExchangeInfo,
  BinanceFundingRate,
  FetchedFundingData,
} from './types';

export class BinanceClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Binance Futures API base URL
    this.baseURL = process.env.BINANCE_API_URL || 'https://fapi.binance.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Binance Futures API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available perpetual futures from Binance
   * Endpoint: GET /fapi/v1/exchangeInfo
   */
  async getAssets(): Promise<BinanceAsset[]> {
    try {
      logger.info('Fetching assets from Binance Futures');

      const response = await this.client.get<BinanceExchangeInfo>('/fapi/v1/exchangeInfo');

      // Filter for PERPETUAL contracts that are actively trading
      const assets = response.data.symbols.filter(
        (s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING'
      );

      logger.info(`Fetched ${assets.length} perpetual assets from Binance Futures`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Binance Futures', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   * Endpoint: GET /fapi/v1/fundingRate
   *
   * Binance Futures funding happens every 8 hours (00:00, 08:00, 16:00 UTC)
   *
   * API Documentation:
   * - Returns SETTLED (historical) rates, not predictive rates
   * - Max limit: 1000 records per request
   * - Default limit: 100 (if not specified)
   * - If startTime and endTime are omitted, returns 200 most recent records
   *
   * Rate Limits:
   * - This endpoint is limited to 500 requests per 5 minutes per IP
   * - Shared limit with GET /fapi/v1/fundingInfo
   * - Equivalent to ~100 requests per minute
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol} from Binance`);

      // Calculate time range: 480 hours ago to match Hyperliquid's depth
      // This equals 60 funding periods (480h / 8h per period)
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const response = await this.client.get<BinanceFundingRate[]>('/fapi/v1/fundingRate', {
        params: {
          symbol,
          startTime,
          endTime, // Added for explicit time range definition
          limit: 1000, // Max allowed by Binance
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
        premium: '0', // Binance doesn't provide separate premium in this endpoint
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
   * Binance Rate Limits:
   * - /fapi/v1/fundingRate endpoint: 500 requests per 5 minutes per IP
   * - Shared limit with /fapi/v1/fundingInfo
   * - Equivalent to ~100 requests per minute
   *
   * Default Strategy:
   * - 500ms delay = 120 requests/min (slightly above limit)
   * - Recommended: Adjust to 600ms (100 req/min) for strict compliance
   * - Current 500ms is acceptable for moderate use (allows bursts, averages below limit)
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 600, // Adjusted to 600ms = 100 req/min to respect rate limit
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Binance Futures`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching ${symbol} from Binance...`);
          const data = await this.getFundingHistory(symbol);
          results.set(symbol, data);
          logger.info(`[API] ✓ ${symbol}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Binance Futures`);

    return results;
  }
}

export default BinanceClient;
