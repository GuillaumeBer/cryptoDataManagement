import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import { RateLimiter } from '../../utils/rateLimiter';
import {
  BybitAsset,
  BybitInstrumentsResponse,
  BybitFundingRateHistoryResponse,
  FetchedFundingData,
  BybitKlineResponse,
  FetchedOHLCVData,
  BybitOpenInterestResponse,
  FetchedOIData,
  BybitAccountRatioResponse,
  FetchedLongShortRatioData,
  BybitLiquidationResponse,
  FetchedLiquidationData,
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
  private isBanned: boolean = false;

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
   * Check if IP is currently banned
   */
  public isBannedStatus(): boolean {
    return this.isBanned;
  }

  /**
   * Wrapper for axios requests with retry logic on rate limits
   * - Retries on HTTP 429 (rate limited) with exponential backoff
   * - Throws IpBannedError on HTTP 418 or 403 (IP banned)
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

          // HTTP 418 or 403: IP banned - stop immediately
          if (status === 418 || status === 403) {
            this.isBanned = true;
            const banMsg = this.getErrorMessage(error);
            logger.error(`IP BANNED by Bybit: ${banMsg}`);
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
  async getAssets(): Promise<BybitAsset[]> {
    try {
      logger.info('Fetching perpetual contracts from Bybit');

      const data = await this.requestWithRetry<BybitInstrumentsResponse>('get', '/v5/market/instruments-info', {
        params: {
          category: 'linear', // USDT perpetual contracts
          limit: 1000, // Get as many as possible in one request
        },
      });

      // Check if request was successful
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg}`);
      }

      // Filter for active trading contracts and perpetuals only
      const assets = data.result.list.filter(
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

      const data = await this.requestWithRetry<BybitFundingRateHistoryResponse>('get', '/v5/market/funding/history', {
        params: {
          category: 'linear',
          symbol,
          startTime,
          endTime,
          limit: 200, // Maximum allowed per request
        },
      });

      // Check if request was successful
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg}`);
      }

      const fundingData = data.result.list;
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
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedFundingData[]) => Promise<void>
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Bybit`);

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
          logger.info(`[API] Fetching ${symbol} from Bybit...`);
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
            logger.error(`IP banned by Bybit`, errorMsg);
            return; // Stop processing this and future symbols
          }

          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);

          // Store empty array for failed symbols to maintain consistency
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Bybit`);

    return results;
  }

  /**
   * Fetch OHLCV (kline) history for a specific symbol
   * Endpoint: GET /v5/market/kline
   *
   * API Documentation:
   * - Max limit: 1000 records per request
   * - Interval: 60 for 1-hour candles (in minutes)
   *
   * Rate Limits:
   * - 50 requests per 2 seconds
   */
  async getOHLCV(symbol: string, interval: string = '60'): Promise<FetchedOHLCVData[]> {
    try {
      logger.debug(`Fetching OHLCV history for ${symbol} from Bybit`);

      // Calculate time range: 480 hours ago to match funding rate depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const data = await this.requestWithRetry<BybitKlineResponse>('get', '/v5/market/kline', {
        params: {
          category: 'linear',
          symbol,
          interval,
          start: startTime,
          end: endTime,
          limit: 1000, // Max allowed by Bybit
        },
      });

      // Check if request was successful
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg}`);
      }

      const klines = data.result.list;
      if (!klines || !Array.isArray(klines)) {
        logger.warn(`No OHLCV data found for ${symbol}`);
        return [];
      }

      const results: FetchedOHLCVData[] = klines.map((kline) => ({
        asset: symbol,
        timestamp: new Date(parseInt(kline[0])),
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
        quoteVolume: kline[6],
        tradesCount: 0, // Bybit doesn't provide trade count in kline data
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
   * Bybit Rate Limits:
   * - /v5/market/kline endpoint: 50 requests per 2 seconds
   * - Conservative delay: 600ms (100 requests/min) to stay well within limits
   */
  async getOHLCVBatch(
    symbols: string[],
    interval: string = '60',
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOHLCVData[]) => Promise<void>
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from Bybit`);

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
          logger.info(`[API] Fetching OHLCV ${symbol} from Bybit...`);
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
            logger.error(`IP banned by Bybit`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} OHLCV records from Bybit`);

    return results;
  }

  /**
   * Helper function to find the closest OHLCV price for a given timestamp
   * Used to calculate OI value from OI contracts
   */
  private findClosestPrice(timestamp: Date, ohlcvData: FetchedOHLCVData[]): string | undefined {
    if (!ohlcvData || ohlcvData.length === 0) {
      return undefined;
    }

    const targetTime = timestamp.getTime();

    // Find the closest OHLCV record (within 1 hour tolerance)
    let closestRecord: FetchedOHLCVData | undefined;
    let minTimeDiff = Infinity;
    const ONE_HOUR = 60 * 60 * 1000;

    for (const record of ohlcvData) {
      const recordTime = record.timestamp.getTime();
      const timeDiff = Math.abs(targetTime - recordTime);

      // Only consider records within 1 hour of the OI timestamp
      if (timeDiff <= ONE_HOUR && timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestRecord = record;
      }
    }

    return closestRecord?.close;
  }

  /**
   * Calculate OI value from OI contracts using OHLCV price data
   */
  private calculateOIValue(openInterest: string, price: string | undefined): string | undefined {
    if (!price) {
      return undefined;
    }

    try {
      const oiContracts = parseFloat(openInterest);
      const priceValue = parseFloat(price);

      if (isNaN(oiContracts) || isNaN(priceValue)) {
        return undefined;
      }

      const oiValue = oiContracts * priceValue;
      return oiValue.toString();
    } catch {
      return undefined;
    }
  }

  /**
   * Fetch open interest history for a specific symbol
   * Endpoint: GET /v5/market/open-interest
   *
   * API Documentation:
   * - Supports intervals: 5min, 15min, 30min, 1h, 4h, 1d
   * - Max limit: 200 records per request
   *
   * Rate Limits:
   * - 50 requests per 2 seconds (~1500 req/min)
   *
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @param intervalTime - Time interval for OI data (default: "1h")
   * @param ohlcvData - Optional OHLCV data to calculate OI value from contracts
   */
  async getOpenInterest(
    symbol: string,
    intervalTime: string = '1h',
    ohlcvData?: FetchedOHLCVData[]
  ): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest history for ${symbol} from Bybit`);

      // Calculate time range: 480 hours ago to match funding rate and OHLCV depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const data = await this.requestWithRetry<BybitOpenInterestResponse>('get', '/v5/market/open-interest', {
        params: {
          category: 'linear',
          symbol,
          intervalTime,
          startTime,
          endTime,
          limit: 200, // Max allowed by Bybit
        },
      });

      // Check if request was successful
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg}`);
      }

      const oiData = data.result.list;
      if (!oiData || !Array.isArray(oiData)) {
        logger.warn(`No open interest data found for ${symbol}`);
        return [];
      }

      const results: FetchedOIData[] = oiData.map((point) => {
        const timestamp = new Date(parseInt(point.timestamp));
        const openInterest = point.openInterest;

        // Calculate OI value if OHLCV data is provided
        let openInterestValue: string | undefined;
        if (ohlcvData) {
          const price = this.findClosestPrice(timestamp, ohlcvData);
          openInterestValue = this.calculateOIValue(openInterest, price);
        }

        return {
          asset: symbol,
          timestamp,
          openInterest,
          openInterestValue,
        };
      });

      const withValue = results.filter(r => r.openInterestValue !== undefined).length;
      logger.debug(`Fetched ${results.length} open interest records for ${symbol} (${withValue} with calculated value)`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch open interest for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch open interest for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch open interest history for multiple symbols with rate limiting
   *
   * Bybit Rate Limits:
   * - /v5/market/open-interest endpoint: 50 requests per 2 seconds
   * - Conservative delay: 600ms (100 requests/min) to stay well within limits
   *
   * @param symbols - Array of trading pair symbols
   * @param intervalTime - Time interval for OI data (default: "1h")
   * @param delayMs - Delay between requests in milliseconds
   * @param concurrency - Number of concurrent requests
   * @param onProgress - Optional callback for progress tracking
   * @param ohlcvDataMap - Optional map of symbol -> OHLCV data for calculating OI values
   */
  async getOpenInterestBatch(
    symbols: string[],
    intervalTime: string = '1h',
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOIData[]) => Promise<void>,
    ohlcvDataMap?: Map<string, FetchedOHLCVData[]>
  ): Promise<Map<string, FetchedOIData[]>> {
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${symbols.length} assets from Bybit`);
    if (ohlcvDataMap) {
      logger.info(`Using OHLCV data to calculate OI values for ${ohlcvDataMap.size} symbols`);
    }

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
          logger.info(`[API] Fetching OI ${symbol} from Bybit...`);
          const ohlcvData = ohlcvDataMap?.get(symbol);
          const data = await this.getOpenInterest(symbol, intervalTime, ohlcvData);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          const withValue = data.filter(d => d.openInterestValue !== undefined).length;
          const valueInfo = ohlcvData ? ` (${withValue} with value)` : '';
          logger.info(`[API] ✓ ${symbol}: ${data.length} OI records${valueInfo}`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${symbol}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by Bybit`, errorMsg);
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
    const totalWithValue = Array.from(results.values()).reduce(
      (sum, data) => sum + data.filter(d => d.openInterestValue !== undefined).length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} open interest records from Bybit (${totalWithValue} with calculated value)`);

    return results;
  }
  /**
   * Fetch Account Long/Short Ratio
   * Endpoint: GET /v5/market/account-ratio
   *
   * API Documentation:
   * - Returns buy/sell ratio of holders
   * - Supports periods: 5min, 15min, 30min, 1h, 4h, 1d
   * - Max limit: 500 records per request
   *
   * Rate Limits:
   * - 50 requests per 2 seconds
   */
  async getAccountRatio(
    symbol: string,
    period: string = '1h'
  ): Promise<FetchedLongShortRatioData[]> {
    try {
      logger.debug(`Fetching Account L/S Ratio for ${symbol} from Bybit`);

      // Calculate time range: 30 days (typical limit for ratios)
      // const daysAgo = 30;
      // const startTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
      // const endTime = Date.now();

      const data = await this.requestWithRetry<BybitAccountRatioResponse>('get', '/v5/market/account-ratio', {
        params: {
          category: 'linear',
          symbol,
          period,
          limit: 500,
        },
      });

      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg}`);
      }

      const ratioData = data.result.list;
      if (!ratioData || !Array.isArray(ratioData)) {
        logger.warn(`No L/S ratio data found for ${symbol}`);
        return [];
      }

      const results: FetchedLongShortRatioData[] = ratioData.map((point) => ({
        asset: symbol,
        timestamp: new Date(parseInt(point.timestamp)),
        longRatio: parseFloat(point.buyRatio),
        shortRatio: parseFloat(point.sellRatio),
        longAccount: parseFloat(point.buyRatio), // Bybit gives ratios directly
        shortAccount: parseFloat(point.sellRatio),
        platform: 'bybit',
        type: 'account_ratio',
        period,
      }));

      logger.debug(`Fetched ${results.length} L/S ratio records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch L/S ratio for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch L/S ratio for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch L/S Ratio history for multiple symbols with rate limiting
   */
  async getLongShortRatioBatch(
    symbols: string[],
    period: string = '1h',
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedLongShortRatioData[]) => Promise<void>
  ): Promise<Map<string, FetchedLongShortRatioData[]>> {
    const results = new Map<string, FetchedLongShortRatioData[]>();

    logger.info(`Fetching L/S Ratio data for ${symbols.length} assets from Bybit`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        if (this.isBanned) return;

        try {
          logger.info(`[API] Fetching L/S Ratio ${symbol} from Bybit...`);
          const data = await this.getAccountRatio(symbol, period);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          logger.info(`[API] ✓ ${symbol}: ${data.length} L/S records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          if (errorMsg.includes('IP_BANNED')) {
            return;
          }
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          if (!onItemFetched) results.set(symbol, []);
        } finally {
          processed++;
          if (onProgress) onProgress(symbol, processed);
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    return results;
  }

  /**
   * Fetch recent liquidations
   * Endpoint: GET /v5/market/recent-trade (filtered for liquidations)
   * Note: Bybit doesn't have a dedicated liquidation endpoint in public API
   * This is a workaround using recent trades - for production, consider WebSocket
   *
   * Alternative: Use insurance fund data or analyze large trades
   *
   * Rate Limits:
   * - 50 requests per 2 seconds
   */
  async getLiquidations(
    symbol: string,
    limit: number = 500
  ): Promise<FetchedLiquidationData[]> {
    try {
      logger.debug(`Fetching liquidations for ${symbol} from Bybit`);

      // Bybit V5 doesn't have a public liquidation endpoint like Binance
      // We'll use the insurance fund liquidation data instead
      // Endpoint: /v5/market/insurance (for historical insurance fund data)
      
      // Note: This is a placeholder implementation
      // For real liquidation data, you'd need to:
      // 1. Use WebSocket stream for real-time liquidations
      // 2. Parse large trades from recent-trade endpoint
      // 3. Use a private API if available

      logger.warn(`Bybit public API doesn't provide direct liquidation data for ${symbol}`);
      return [];
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch liquidations for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch liquidations for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch liquidations for multiple symbols with rate limiting
   * Note: Bybit doesn't provide public liquidation endpoint
   */
  async getLiquidationsBatch(
    symbols: string[],
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedLiquidationData[]) => Promise<void>
  ): Promise<Map<string, FetchedLiquidationData[]>> {
    const results = new Map<string, FetchedLiquidationData[]>();

    logger.info(`Bybit liquidation data not available via public API for ${symbols.length} assets`);
    logger.info(`Consider using WebSocket streams or alternative data sources`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        if (this.isBanned) return;

        try {
          logger.info(`[API] Skipping Liquidations ${symbol} from Bybit (not available)`);
          const data: FetchedLiquidationData[] = [];

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          logger.info(`[API] ✓ ${symbol}: 0 liquidation records (not supported)`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          if (errorMsg.includes('IP_BANNED')) {
            return;
          }
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          if (!onItemFetched) results.set(symbol, []);
        } finally {
          processed++;
          if (onProgress) onProgress(symbol, processed);
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    return results;
  }
}


export default BybitClient;
