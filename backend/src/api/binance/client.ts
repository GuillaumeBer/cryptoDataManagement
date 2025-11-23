import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import { RateLimiter } from '../../utils/rateLimiter';
import {
  BinanceAsset,
  BinanceExchangeInfo,
  BinanceFundingRate,
  FetchedFundingData,
  BinanceKline,
  FetchedOHLCVData,
  BinanceOpenInterest,
  FetchedOIData,
  BinanceLongShortRatio,
  FetchedLongShortRatioData,
  BinanceLiquidation,
  FetchedLiquidationData,
} from './types';

export class BinanceClient {
  private client: AxiosInstance;
  private baseURL: string;
  private isBanned: boolean = false;

  constructor() {
    // Binance Futures API base URL
    this.baseURL = process.env.BINANCE_API_URL || 'https://fapi.binance.com';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };

    // Add API key if present
    if (process.env.BINANCE_API_KEY) {
      headers['X-MBX-APIKEY'] = process.env.BINANCE_API_KEY;
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers,
    });

    logger.info('Binance Futures API client initialized', { 
      baseURL: this.baseURL,
      hasApiKey: !!process.env.BINANCE_API_KEY 
    });
  }

  public isBannedStatus(): boolean {
    return this.isBanned;
  }

  /**
   * Wrapper for axios requests with retry logic on rate limits
   * - Retries on HTTP 429 (rate limited) with exponential backoff
   * - Throws IpBannedError on HTTP 418 (IP banned)
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

          // HTTP 418: IP banned - stop immediately
          if (status === 418) {
            this.isBanned = true;
            const banMsg = this.getErrorMessage(error);
            logger.error(`IP BANNED by Binance: ${banMsg}`);
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
   * Fetch all available perpetual futures from Binance
   * Endpoint: GET /fapi/v1/exchangeInfo
   */
  async getAssets(): Promise<BinanceAsset[]> {
    try {
      logger.info('Fetching assets from Binance Futures');

      const data = await this.requestWithRetry<BinanceExchangeInfo>('get', '/fapi/v1/exchangeInfo');

      // Filter for PERPETUAL contracts that are actively trading
      const assets = data.symbols.filter(
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

      const fundingData = await this.requestWithRetry<BinanceFundingRate[]>('get', '/fapi/v1/fundingRate', {
        params: {
          symbol,
          startTime,
          endTime, // Added for explicit time range definition
          limit: 1000, // Max allowed by Binance
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
   * - 700ms delay = ~86 requests/min to provide 14% safety margin
   * - This ensures we never hit the 100 req/min limit even with slight timing variations
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 700, // 700ms = ~86 req/min, providing 14% safety margin under 100 req/min limit
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedFundingData[]) => Promise<void>
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Binance Futures`);

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
          logger.info(`[API] Fetching ${symbol} from Binance...`);
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
            logger.error(`IP banned by Binance`, errorMsg);
            return; // Stop processing this and future symbols
          }

          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from Binance Futures`);

    return results;
  }

  /**
   * Fetch OHLCV (klines) history for a specific symbol
   * Endpoint: GET /fapi/v1/klines
   *
   * API Documentation:
   * - Max limit: 1500 records per request
   * - If startTime and endTime are omitted, returns most recent klines
   * - Interval: 1h for 1-hour candles
   *
   * Rate Limits:
   * - Weight: 5 per request
   * - Rate limit: 2400 requests per minute
   */
  async getOHLCV(symbol: string, interval: string = '1h'): Promise<FetchedOHLCVData[]> {
    try {
      logger.debug(`Fetching OHLCV history for ${symbol} from Binance`);

      // Calculate time range: 480 hours ago to match funding rate depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const klines = await this.requestWithRetry<BinanceKline[]>('get', '/fapi/v1/klines', {
        params: {
          symbol,
          interval,
          startTime,
          endTime,
          limit: 1500, // Max allowed by Binance
        },
      });

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
        quoteVolume: kline[7],
        tradesCount: kline[8],
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
   * Binance Rate Limits:
   * - /fapi/v1/klines endpoint: Weight 5, 2400 requests per minute
   * - Much higher limit than funding rate endpoint
   *
   * Default Strategy:
   * - 700ms delay = ~86 requests/min for consistency with funding rate endpoint
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

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from Binance Futures`);

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
          logger.info(`[API] Fetching OHLCV ${symbol} from Binance...`);
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
            logger.error(`IP banned by Binance`, errorMsg);
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
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 5 }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} OHLCV records from Binance Futures`);

    return results;
  }

  /**
   * Fetch open interest history for a specific symbol
   * Endpoint: GET /futures/data/openInterestHist
   *
   * API Documentation:
   * - Historical OI endpoint (not the realtime /fapi/v1/openInterest)
   * - Supports periods: 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d
   * - Max limit: 500 records per request
   *
   * Rate Limits:
   * - Weight: 1 per request
   * - Very permissive (2400 requests per minute)
   */
  async getOpenInterest(symbol: string, period: string = '1h'): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest history for ${symbol} from Binance`);

      // Calculate time range: 480 hours ago to match funding rate and OHLCV depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const oiData = await this.requestWithRetry<BinanceOpenInterest[]>(
        'get',
        '/futures/data/openInterestHist',
        {
          params: {
            symbol,
            period,
            contractType: 'PERPETUAL',
            startTime,
            endTime,
            limit: 500, // Max allowed by Binance
          },
        }
      );

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
   * Binance Rate Limits:
   * - /futures/data/openInterestHist endpoint: Weight 1, 2400 requests per minute
   * - Very high limit, using same conservative delay as other endpoints
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
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${symbols.length} assets from Binance Futures`);

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
          logger.info(`[API] Fetching OI ${symbol} from Binance...`);
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
            logger.error(`IP banned by Binance`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} open interest records from Binance Futures`);

    return results;
  }
  /**
   * Fetch Top Trader Long/Short Position Ratio
   * Endpoint: GET /futures/data/topLongShortPositionRatio
   *
   * API Documentation:
   * - Returns historical ratio data
   * - Supports periods: 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d
   * - Max limit: 500 records per request
   *
   * Rate Limits:
   * - Weight: 1 per request
   */
  async getTopLongShortPositionRatio(
    symbol: string,
    period: string = '1h'
  ): Promise<FetchedLongShortRatioData[]> {
    try {
      logger.debug(`Fetching Top Trader L/S Position Ratio for ${symbol} from Binance`);

      // Calculate time range: 30 days (Binance limit for this endpoint)
      const daysAgo = 30;
      const startTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
      const endTime = Date.now();

      const ratioData = await this.requestWithRetry<BinanceLongShortRatio[]>(
        'get',
        '/futures/data/topLongShortPositionRatio',
        {
          params: {
            symbol,
            period,
            startTime,
            endTime,
            limit: 500,
          },
        }
      );

      if (!ratioData || !Array.isArray(ratioData)) {
        logger.warn(`No L/S ratio data found for ${symbol}`);
        return [];
      }

      const results: FetchedLongShortRatioData[] = ratioData.map((point) => ({
        asset: symbol,
        timestamp: new Date(point.timestamp),
        longRatio: parseFloat(point.longAccount), // Binance returns string "0.6543"
        shortRatio: parseFloat(point.shortAccount),
        longAccount: parseFloat(point.longAccount), // For position ratio, these are the same
        shortAccount: parseFloat(point.shortAccount),
        platform: 'binance',
        type: 'top_trader_position',
        period,
      }));

      logger.debug(`Fetched ${results.length} L/S ratio records for ${symbol}`);
      return results;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
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
    delayMs: number = 700,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedLongShortRatioData[]) => Promise<void>
  ): Promise<Map<string, FetchedLongShortRatioData[]>> {
    const results = new Map<string, FetchedLongShortRatioData[]>();

    logger.info(`Fetching L/S Ratio data for ${symbols.length} assets from Binance Futures`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        if (this.isBanned) return;

        try {
          logger.info(`[API] Fetching L/S Ratio ${symbol} from Binance...`);
          const data = await this.getTopLongShortPositionRatio(symbol, period);

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
   * Fetch recent liquidations (force orders)
   * Endpoint: GET /fapi/v1/forceOrders
   *
   * API Documentation:
   * - Returns recent liquidation orders
   * - Max limit: 1000 records per request
   * - Covers approximately last 7 days
   *
   * Rate Limits:
   * - Weight: 20 per request (for specific symbol)
   * - Weight: 50 per request (all symbols)
   */
  async getLiquidations(
    symbol?: string,
    startTime?: number,
    endTime?: number
  ): Promise<FetchedLiquidationData[]> {
    // Check if API key is present
    if (!process.env.BINANCE_API_KEY) {
      logger.debug('Skipping liquidation fetch: BINANCE_API_KEY not configured');
      return [];
    }

    try {
      logger.debug(`Fetching liquidations${symbol ? ` for ${symbol}` : ' (all symbols)'} from Binance`);

      const params: any = {
        limit: 1000,
      };

      if (symbol) {
        params.symbol = symbol;
      }

      if (startTime) {
        params.startTime = startTime;
      }

      if (endTime) {
        params.endTime = endTime;
      }

      const liquidations = await this.requestWithRetry<BinanceLiquidation[]>(
        'get',
        '/fapi/v1/forceOrders',
        { params }
      );

      if (!liquidations || !Array.isArray(liquidations)) {
        logger.warn(`No liquidation data found${symbol ? ` for ${symbol}` : ''}`);
        return [];
      }

      const results: FetchedLiquidationData[] = liquidations.map((liq) => {
        const quantity = parseFloat(liq.executedQty);
        const price = parseFloat(liq.avgPrice);
        
        return {
          asset: liq.symbol,
          timestamp: new Date(liq.time),
          side: liq.side === 'LONG' ? 'Long' : 'Short',
          price,
          quantity,
          volumeUsd: quantity * price,
          platform: 'binance',
        };
      });

      logger.debug(`Fetched ${results.length} liquidation records${symbol ? ` for ${symbol}` : ''}`);
      return results;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch liquidations${symbol ? ` for ${symbol}` : ''}: ${errorMsg}`);
      throw new Error(`Failed to fetch liquidations${symbol ? ` for ${symbol}` : ''}: ${errorMsg}`);
    }
  }

  /**
   * Fetch liquidations for multiple symbols with rate limiting
   */
  async getLiquidationsBatch(
    symbols: string[],
    options: {
      delayMs?: number;
      concurrency?: number;
      lookbackDays?: number;
      state?: string;
    } = {},
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedLiquidationData[]) => Promise<void>
  ): Promise<Map<string, FetchedLiquidationData[]>> {
    const results = new Map<string, FetchedLiquidationData[]>();

    logger.info(`Fetching liquidation data for ${symbols.length} assets from Binance Futures`);

    const lookbackDays = options.lookbackDays ?? 7;
    const delayMs = options.delayMs ?? 1000;
    const safeConcurrency = Math.max(1, options.concurrency ?? 1);

    // Calculate time range
    const endTime = Date.now();
    const startTime = endTime - (lookbackDays * 24 * 60 * 60 * 1000);
    
    let processed = 0;

    await runPromisePool(
      symbols,
      async (symbol) => {
        if (this.isBanned) return;

        try {
          logger.info(`[API] Fetching Liquidations ${symbol} from Binance...`);
          const data = await this.getLiquidations(symbol, startTime, endTime);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          logger.info(`[API] ✓ ${symbol}: ${data.length} liquidation records`);
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
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 20 }
    );

    return results;
  }
}


export default BinanceClient;
