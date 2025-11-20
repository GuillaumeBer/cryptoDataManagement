import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import { RateLimiter } from '../../utils/rateLimiter';
import {
  AsterAsset,
  AsterExchangeInfo,
  AsterFundingRate,
  FetchedFundingData,
  AsterKline,
  FetchedOHLCVData,
  // AsterOpenInterest, // unused
  FetchedOIData,
} from './types';

export class AsterClient {
  private client: AxiosInstance;
  private baseURL: string;
  private isBanned: boolean = false;

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

  /**
   * Check if IP is currently banned
   */
  public isBannedStatus(): boolean {
    return this.isBanned;
  }

  /**
   * Wrapper for axios requests with retry logic on rate limits
   * - Retries on HTTP 429 (rate limited) with exponential backoff
   * - Throws error on HTTP 418/403 (IP banned or forbidden)
   */
  private async requestWithRetry<T>(
    method: 'get' | 'post',
    url: string,
    config?: any,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = method === 'get'
          ? await this.client.get<T>(url, config)
          : await this.client.post<T>(url, config);
        return response.data;
      } catch (error: any) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;

          // HTTP 418/403: IP banned or forbidden - stop immediately
          if (status === 418 || status === 403) {
            this.isBanned = true;
            const banMsg = this.getErrorMessage(error);
            logger.error(`IP BANNED/FORBIDDEN by Aster: ${banMsg}`);
            throw new Error(`IP_BANNED: ${banMsg}`);
          }

          // HTTP 429: Rate limited - retry with exponential backoff
          if (status === 429 && attempt < maxRetries) {
            const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            logger.warn(`Rate limited on ${url}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
        }

        lastError = error;
      }
    }

    // All retries exhausted
    throw lastError;
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

      const data = await this.requestWithRetry<AsterExchangeInfo>('get', '/fapi/v1/exchangeInfo');

      const assets = data.symbols.filter(
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

      const fundingData = await this.requestWithRetry<AsterFundingRate[]>('get', '/fapi/v1/fundingRate', {
        params: {
          symbol,
          startTime,
          endTime,
          limit: 1000, // Max limit
        },
      });
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
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedFundingData[]) => Promise<void>
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Aster`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${symbol} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching ${symbol} from Aster...`);
          const data = await this.getFundingHistory(symbol);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          logger.info(`[API] ✓ ${symbol}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${symbol}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by Aster`, errorMsg);
            return;
          }

          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);
          if (!onItemFetched) {
            results.set(symbol, []);
          }
        } finally {
          processed++;
          // Emit progress callback
          if (onProgress) {
            onProgress(symbol, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
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

      const klines = await this.requestWithRetry<AsterKline[]>('get', '/fapi/v1/klines', {
        params: {
          symbol,
          interval,
          startTime,
          endTime,
          limit: 1500, // Max allowed (similar to Binance)
        },
      });

      // Temporary log to inspect raw API response
      logger.info(`Raw OHLCV data for ${symbol} from Aster:`, klines);
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
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOHLCVData[]) => Promise<void>
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from Aster`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${symbol} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching OHLCV ${symbol} from Aster...`);
          const data = await this.getOHLCV(symbol, interval);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          logger.info(`[API] ✓ ${symbol}: ${data.length} OHLCV records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${symbol}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by Aster`, errorMsg);
            return;
          }

          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch OHLCV for ${symbol}`, errorMsg);
          if (!onItemFetched) {
            results.set(symbol, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(symbol, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} OHLCV records from Aster`);

    return results;
  }

  /**
   * Fetch open interest for a specific symbol
   * Endpoint: GET /fapi/v1/openInterest (Binance-compatible)
   *
   * IMPORTANT: Aster does NOT have a historical OI endpoint like Binance
   * (/futures/data/openInterestHist returns 404).
   *
   * Instead, we use the real-time endpoint /fapi/v1/openInterest which returns
   * a single snapshot:
   * {
   *   "symbol": "BTCUSDT",
   *   "openInterest": "5458.092",
   *   "time": 1763619371908
   * }
   *
   * Historical data will be built up over time as we periodically fetch snapshots.
   */
  async getOpenInterest(symbol: string, period: string = '1h'): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest snapshot for ${symbol} from Aster`);

      // Use the real-time endpoint (only endpoint available)
      const oiSnapshot = await this.requestWithRetry<{ symbol: string; openInterest: string; time: number }>(
        'get',
        '/fapi/v1/openInterest',
        {
          params: { symbol },
        }
      );
      if (!oiSnapshot || !oiSnapshot.openInterest) {
        logger.warn(`No open interest data found for ${symbol}`);
        return [];
      }

      // Return a single data point (the current snapshot)
      const result: FetchedOIData = {
        asset: symbol,
        timestamp: new Date(oiSnapshot.time),
        openInterest: oiSnapshot.openInterest,
        openInterestValue: undefined, // Not provided by Aster
      };

      logger.debug(`Fetched open interest snapshot for ${symbol}: OI=${oiSnapshot.openInterest}`);
      return [result];
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
   * Fetch open interest snapshots for multiple symbols with rate limiting
   *
   * NOTE: Unlike other platforms, Aster only provides real-time snapshots,
   * not historical data. Each call returns a single data point per symbol.
   * Historical data is built up over time through periodic fetches.
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
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOIData[]) => Promise<void>
  ): Promise<Map<string, FetchedOIData[]>> {
    // Fix unused param warning
    void period;
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${symbols.length} assets from Aster`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${symbol} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching OI ${symbol} from Aster...`);
          const data = await this.getOpenInterest(symbol, period);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          if (data.length > 0) {
            logger.info(`[API] ✓ ${symbol}: ${data.length} OI records`);
          } else {
            logger.debug(`[API] ○ ${symbol}: No OI data available`);
          }
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${symbol}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by Aster`, errorMsg);
            return;
          }

          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch open interest for ${symbol}`, errorMsg);
          if (!onItemFetched) {
            results.set(symbol, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(symbol, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
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
