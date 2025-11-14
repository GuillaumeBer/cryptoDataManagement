import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  BinanceSymbol,
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
  async getAssets(): Promise<BinanceSymbol[]> {
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
   * Max limit: 1000 records per request
   * Default limit: 100
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol} from Binance`);

      // Calculate startTime: last 20 days (60 funding periods at 8h each)
      const daysAgo = 20;
      const startTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);

      const response = await this.client.get<BinanceFundingRate[]>('/fapi/v1/fundingRate', {
        params: {
          symbol,
          startTime,
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
      console.error(`Failed to fetch funding history for ${symbol}:`, errorMsg);
      logger.error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   *
   * Binance rate limits:
   * - Weight-based system: 2400 per minute
   * - /fapi/v1/fundingRate weight: 1 per request
   *
   * We use conservative 500ms delay = 120 requests/min, well under limit
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 500,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Binance Futures`);

    let processed = 0;
    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol} from Binance...`);
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Binance Futures`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default BinanceClient;
