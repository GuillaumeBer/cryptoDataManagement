import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import {
  AsterAsset,
  AsterExchangeInfo,
  AsterFundingRate,
  FetchedFundingData,
  AsterKline,
  FetchedOHLCVData,
  AsterOpenInterest,
  FetchedOIData,
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
      const status = axiosError.response?.status;
      const statusText = axiosError.response?.statusText;

      // Check if response data is HTML (common for 404 errors)
      const data = axiosError.response?.data;
      const isHtml = typeof data === 'string' && data.trim().startsWith('<!DOCTYPE html>');

      if (isHtml) {
        return `${axiosError.message} (${status} ${statusText})`;
      }

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
   * Using conservative 700ms delay (~86 req/min) to ensure safe operation
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 700,
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

  /**
   * Fetch OHLCV (kline) history for a specific symbol
   * Endpoint: GET /fapi/v1/klines (Binance-compatible)
   *
   * API Documentation:
   * - Aster API is similar to Binance Futures API
   * - Max limit: 1500 records per request
   * - Interval: "1h" for 1-hour candles
   *
   * Rate Limits:
   * - Conservative approach: 700ms delay (~86 req/min)
   */
  async getOHLCV(symbol: string, interval: string = '1h'): Promise<FetchedOHLCVData[]> {
    try {
      logger.debug(`Fetching OHLCV history for ${symbol} from Aster`);

      // Calculate time range: 480 hours ago to match funding rate depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const response = await this.client.get<AsterKline[]>('/fapi/v1/klines', {
        params: {
          symbol,
          interval,
          startTime,
          endTime,
          limit: 1500, // Max allowed (similar to Binance)
        },
      });

      // Temporary log to inspect raw API response
      logger.info(`Raw OHLCV data for ${symbol} from Aster:`, response.data);

      const klines = response.data;
      if (!klines || !Array.isArray(klines)) {
        logger.warn(`No OHLCV data found for ${symbol}`);
        return [];
      }

      const results: FetchedOHLCVData[] = klines.map((kline) => ({
        asset: symbol,
        timestamp: new Date(kline[0]),
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
        quoteVolume: kline[7], // Quote asset volume (following Binance format)
        tradesCount: kline[8], // Number of trades (was incorrectly at index 7)
      }));

      logger.debug(`Fetched ${results.length} OHLCV records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch OHLCV for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch OHLCV for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch OHLCV history for multiple symbols with rate limiting
   *
   * Aster Rate Limits:
   * - Exact limits unknown, using conservative 700ms delay with concurrency=1
   * - This provides ~86 req/min throughput, safe for most exchanges
   */
  async getOHLCVBatch(
    symbols: string[],
    interval: string = '1h',
    delayMs: number = 700,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from Aster`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching OHLCV ${symbol} from Aster...`);
          const data = await this.getOHLCV(symbol, interval);
          results.set(symbol, data);
          logger.info(`[API] ✓ ${symbol}: ${data.length} OHLCV records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch OHLCV for ${symbol}`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} OHLCV records from Aster`);

    return results;
  }

  /**
   * Fetch open interest history for a specific symbol
   * Endpoint: GET /futures/data/openInterestHist (Binance-compatible)
   *
   * Notes:
   * - The realtime /fapi/v1/openInterest endpoint only returns a single point.
   * - We need the historical endpoint to populate the chart.
   * - Supports periods: 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d
   * - Max limit: 500 records per request
   */
  async getOpenInterest(symbol: string, period: string = '1h'): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest history for ${symbol} from Aster`);

      // Calculate time range: 480 hours ago to match funding rate and OHLCV depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const response = await this.client.get<AsterOpenInterest[]>('/futures/data/openInterestHist', {
        params: {
          symbol,
          period,
          contractType: 'PERPETUAL',
          startTime,
          endTime,
          limit: 500, // Max allowed (Binance-compatible)
        },
      });

      const oiData = response.data;
      if (!oiData || !Array.isArray(oiData)) {
        logger.warn(`No open interest data found for ${symbol}`);
        return [];
      }

      const results: FetchedOIData[] = oiData.map((point) => ({
        asset: symbol,
        timestamp: new Date(point.timestamp),
        openInterest: point.sumOpenInterest,
        openInterestValue: point.sumOpenInterestValue,
      }));

      logger.debug(`Fetched ${results.length} open interest records for ${symbol}`);
      return results;
    } catch (error: any) {
      // Handle 404 errors gracefully - some symbols don't have OI data
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug(`No open interest data available for ${symbol} (404 Not Found)`);
        return [];
      }

      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch open interest for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch open interest for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch open interest history for multiple symbols with rate limiting
   *
   * Aster Rate Limits:
   * - Exact limits unknown, using conservative delay
   *
   * Default Strategy:
   * - 700ms delay = ~86 requests/min for consistency with other endpoints
   */
  async getOpenInterestBatch(
    symbols: string[],
    period: string = '1h',
    delayMs: number = 700,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedOIData[]>> {
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${symbols.length} assets from Aster`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching OI ${symbol} from Aster...`);
          const data = await this.getOpenInterest(symbol, period);
          results.set(symbol, data);
          if (data.length > 0) {
            logger.info(`[API] ✓ ${symbol}: ${data.length} OI records`);
          } else {
            logger.debug(`[API] ○ ${symbol}: No OI data available`);
          }
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch open interest for ${symbol}`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} open interest records from Aster`);

    return results;
  }
}

export default AsterClient;
