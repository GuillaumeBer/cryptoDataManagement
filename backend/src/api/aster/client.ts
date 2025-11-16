import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import {
  AsterAsset,
  AsterExchangeInfo,
  AsterFundingRate,
  FetchedFundingData,
} from './types';

export class AsterClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Aster Finance Futures V3 API
    // Documentation: github.com/asterdex/api-docs
    // Note: API structure is nearly identical to Binance USDM Futures
    this.baseURL = this.resolveBaseURL();
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Aster Finance Futures V3 API client initialized', { baseURL: this.baseURL });
  }

  private resolveBaseURL(): string {
    const envUrl = process.env.ASTER_API_URL?.trim();
    if (envUrl) {
      return envUrl;
    }

    const preferredBaseUrls = ['https://fapi.asterdex.com', 'https://api.asterdex.com'];

    return preferredBaseUrls[0];
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
   * Fetch all available perpetual futures assets from Aster
   *
   * Endpoint: /fapi/v1/exchangeInfo (Binance-compatible)
   * Filters for TRADING status and PERPETUAL contract type
   */
  async getAssets(): Promise<AsterAsset[]> {
    try {
      logger.info('Fetching perpetual contracts from Aster Finance Futures');

      const response = await this.client.get<AsterExchangeInfo>('/fapi/v1/exchangeInfo');

      const assets = response.data.symbols.filter(
        (s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL'
      );

      logger.info(`Fetched ${assets.length} active perpetual contracts from Aster`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Aster', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   *
   * Endpoint: /fapi/v1/fundingRate (Binance-compatible)
   *
   * Aster uses hourly funding intervals
   * Historical depth: 480 hours (480 funding periods at 1h intervals)
   *
   * Parameters (all optional):
   * - symbol: Trading pair (e.g., "BTCUSDT")
   * - startTime: Start timestamp in milliseconds
   * - endTime: End timestamp in milliseconds
   * - limit: Number of results (default 100, max 1000)
   *
   * Response format:
   * [
   *   {
   *     "symbol": "BTCUSDT",
   *     "fundingRate": "0.00010000",
   *     "fundingTime": 1234567890000,
   *     "markPrice": "50000.00"
   *   }
   * ]
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol} from Aster`);

      // Calculate time range: last 480 hours
      const hoursAgo = 480;
      const endTime = Date.now();
      const startTime = endTime - hoursAgo * 60 * 60 * 1000;

      const response = await this.client.get<AsterFundingRate[]>('/fapi/v1/fundingRate', {
        params: {
          symbol,
          startTime,
          endTime,
          limit: 1000, // Max limit
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
        premium: point.markPrice || '0', // Use markPrice as premium if available
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${symbol} from Aster`);
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
   * Aster enforces rate limits similar to Binance
   * Default delay: 200ms between requests to avoid 429 errors
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 200,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Aster`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching ${symbol} from Aster...`);
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
          // Emit progress callback
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Aster`);

    return results;
  }
}

export default AsterClient;
