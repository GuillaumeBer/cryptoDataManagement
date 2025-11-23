import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import { RateLimiter } from '../../utils/rateLimiter';
import {
  OKXAsset,
  OKXInstrumentsResponse,
  OKXFundingRateHistoryResponse,
  FetchedFundingData,
  OKXKlineResponse,
  FetchedOHLCVData,
  // OKXOpenInterestResponse, // unused
  OKXOpenInterestHistoryResponse,
  FetchedOIData,
  OKXLongShortRatioResponse,
  FetchedLongShortRatioData,
  OKXLiquidationResponse,
  FetchedLiquidationData,
} from './types';

/**
 * OKX V5 API Client
 *
 * Documentation: https://www.okx.com/docs-v5/en/
 *
 * Funding Rate Information:
 * - OKX uses 8-hour funding intervals (00:00, 08:00, 16:00 UTC)
 * - Funding rate is settled at these specific times
 * - Historical funding rate data available via /api/v5/public/funding-rate-history
 *
 * Rate Limits (as of V5 API):
 * - Public endpoints: 20 requests per 2 seconds per IP
 * - Equivalent to ~600 requests per minute
 * - Conservative delay: 600ms (100 requests/min) to stay well within limits
 */
export class OKXClient {
  private client: AxiosInstance;
  private baseURL: string;
  private isBanned: boolean = false;

  constructor() {
    // OKX V5 API base URL
    this.baseURL = process.env.OKX_API_URL || 'https://www.okx.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('OKX V5 API client initialized', { baseURL: this.baseURL });
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
   * - Throws Error on HTTP 418 or 403 (IP banned)
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
            logger.error(`IP BANNED by OKX: ${banMsg}`);
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
        return `${axiosError.message}: ${data.msg || JSON.stringify(data).substring(0, 200)}`;
      }
      return axiosError.message;
    }
    return String(error);
  }

  /**
   * Fetch all available USDT perpetual swaps from OKX
   *
   * Endpoint: GET /api/v5/public/instruments
   * Documentation: https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments
   *
   * Query Parameters:
   * - instType: "SWAP" (for perpetual swaps)
   *
   * Rate Limit: 20 requests per 2 seconds
   */
  async getAssets(): Promise<OKXAsset[]> {
    try {
      logger.info('Fetching perpetual swaps from OKX');

      const data = await this.requestWithRetry<OKXInstrumentsResponse>('get', '/api/v5/public/instruments', {
        params: {
          instType: 'SWAP', // Perpetual swaps
        },
      });

      // Check if request was successful
      if (data.code !== '0') {
        throw new Error(`OKX API error: ${data.msg}`);
      }

      // Filter for live USDT-settled linear perpetual contracts
      const assets = data.data.filter(
        (instrument) =>
          instrument.state === 'live' &&
          instrument.ctType === 'linear' &&
          instrument.settleCcy === 'USDT'
      );

      logger.info(`Fetched ${assets.length} active USDT perpetual swaps from OKX`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from OKX', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific instrument
   *
   * Endpoint: GET /api/v5/public/funding-rate-history
   * Documentation: https://www.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history
   *
   * OKX Funding Rate Details:
   * - Funding occurs every 8 hours at 00:00, 08:00, 16:00 UTC
   * - Each funding period is 8 hours (480 minutes)
   * - Historical data: default 480 hours = 60 funding periods
   *
   * Query Parameters:
   * - instId: e.g., "BTC-USDT-SWAP" (required)
   * - before: Unix timestamp in milliseconds (pagination, get data before this time)
   * - after: Unix timestamp in milliseconds (pagination, get data after this time)
   * - limit: max 100 records per request (default 100)
   *
   * Rate Limit: 20 requests per 2 seconds
   *
   * Note: OKX uses reverse chronological order (newest first)
   * We need to paginate if more than 100 records are needed
   *
   * @param instId - Instrument ID (e.g., "BTC-USDT-SWAP")
   * @param hours - Number of hours to look back (default: 480 hours = 60 periods)
   */
  async getFundingHistory(instId: string, hours: number = 480): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${instId} from OKX (last ${hours} hours)`);

      // Calculate time range based on requested hours
      const after = Date.now() - (hours * 60 * 60 * 1000);

      // OKX returns data in reverse chronological order (newest first)
      // and limits to 100 records per request
      // Calculate expected number of periods (8h each)
      const expectedPeriods = Math.ceil(hours / 8);
      const allResults: FetchedFundingData[] = [];
      let currentBefore: number | null = null; // Don't set 'before' on first request
      let hasMore = true;
      let isFirstRequest = true;

      // Fetch up to 100 records at a time until we have enough or no more data
      while (hasMore && allResults.length < expectedPeriods) {
        // Build request params
        // Note: OKX doesn't like 'before' on first request - returns empty
        // Only use 'before' for pagination (subsequent requests)
        const params: any = {
          instId,
          limit: 100,
        };

        if (!isFirstRequest && currentBefore !== null) {
          params.before = currentBefore.toString();
        }

        const data = await this.requestWithRetry<OKXFundingRateHistoryResponse>('get', '/api/v5/public/funding-rate-history', {
          params,
        });

        isFirstRequest = false;

        // Check if request was successful
        if (data.code !== '0') {
          throw new Error(`OKX API error: ${data.msg}`);
        }

        const fundingData = data.data;

        // Debug logging to see what OKX is returning
        if (!fundingData || !Array.isArray(fundingData) || fundingData.length === 0) {
          logger.warn(`No funding data from OKX for ${instId}. Response:`, {
            code: data.code,
            msg: data.msg,
            dataLength: fundingData?.length || 0,
            params: { instId, before: currentBefore, after, limit: 100 }
          });
          hasMore = false;
          break;
        }

        // Convert to our standard format
        const batchResults: FetchedFundingData[] = fundingData.map((point) => ({
          asset: instId,
          timestamp: new Date(parseInt(point.fundingTime)),
          fundingRate: point.fundingRate,
          premium: '0', // OKX doesn't provide premium separately
        }));

        allResults.push(...batchResults);

        // If we got less than 100 records, we've reached the end
        if (fundingData.length < 100) {
          hasMore = false;
        } else {
          // Set 'before' to the oldest timestamp we just received for next page
          const oldestTimestamp = parseInt(fundingData[fundingData.length - 1].fundingTime);

          // Stop if we've gone back before our 'after' limit (480 hours ago)
          if (oldestTimestamp <= after) {
            logger.debug(`Reached time limit for ${instId}, stopping pagination`);
            hasMore = false;
          } else {
            currentBefore = oldestTimestamp;

            // Small delay between pagination requests to avoid rate limiting
            await this.sleep(100);
          }
        }
      }

      // Filter out any records older than our 'after' timestamp
      const filteredResults = allResults.filter(r => r.timestamp.getTime() >= after);

      logger.debug(`Fetched ${filteredResults.length} funding rate records for ${instId} (${allResults.length} total, filtered to time range)`);
      return filteredResults;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch funding history for ${instId}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${instId}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple instruments with rate limiting
   *
   * Rate Limiting Strategy:
   * - OKX allows 20 requests per 2 seconds (~600 req/min)
   * - We use 600ms delay (100 req/min) to be conservative
   * - This ensures we stay well within limits even with concurrent requests
   *
   * @param instIds - Array of instrument IDs (e.g., ["BTC-USDT-SWAP", "ETH-USDT-SWAP"])
   * @param delayMs - Delay between requests in milliseconds (default: 600ms)
   * @param onProgress - Optional callback for progress tracking
   * @returns Map of instrument ID to funding data array
   */
  async getFundingHistoryBatch(
    instIds: string[],
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedFundingData[]) => Promise<void>
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${instIds.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      instIds,
      async (instId) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${instId} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching ${instId} from OKX...`);
          const data = await this.getFundingHistory(instId);

          if (onItemFetched) {
            await onItemFetched(instId, data);
          } else {
            results.set(instId, data);
          }

          logger.info(`[API] ✓ ${instId}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${instId}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by OKX`, errorMsg);
            return; // Stop processing this and future symbols
          }

          logger.error(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${instId}`, errorMsg);

          // Store empty array for failed instruments to maintain consistency
          if (!onItemFetched) {
            results.set(instId, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(instId, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from OKX`);

    return results;
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch OHLCV (candlestick) history for a specific symbol
   * Endpoint: GET /api/v5/market/history-candles
   *
   * API Documentation:
   * - Max limit: 100 records per request (need multiple requests)
   * - Bar: "1H" for 1-hour candles
   *
   * Rate Limits:
   * - 20 requests per 2 seconds
   */
  async getOHLCV(symbol: string, bar: string = '1H'): Promise<FetchedOHLCVData[]> {
    try {
      logger.debug(`Fetching OHLCV history for ${symbol} from OKX`);

      // Calculate time range: 480 hours ago to match funding rate depth
      const hoursAgo = 480;
      const targetStart = Date.now() - hoursAgo * 60 * 60 * 1000;

      // OKX limits to 100 candles per request, need to fetch in batches.
      // Only the "after" cursor should be used - combining it with "before" results
      // in empty responses. We walk backwards from now until we reach the target window.
      const allResults: FetchedOHLCVData[] = [];
      let currentAfter = Date.now();
      let safetyCounter = 0;
      const maxBatches = 20; // 20 * 100 candles = 2,000 hours of history buffer

      while (currentAfter > targetStart && safetyCounter < maxBatches) {
        const data = await this.requestWithRetry<OKXKlineResponse>('get', '/api/v5/market/history-candles', {
          params: {
            instId: symbol,
            bar,
            after: currentAfter.toString(),
            limit: '100',
          },
        });

        // Check if request was successful
        if (data.code !== '0') {
          throw new Error(`OKX API error: ${data.msg}`);
        }

        const candles = data.data;
        if (!candles || !Array.isArray(candles) || candles.length === 0) {
          break; // No more data
        }

        const batchResults: FetchedOHLCVData[] = candles
          .map((candle) => ({
            asset: symbol,
            timestamp: new Date(parseInt(candle[0], 10)),
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: candle[5],
            quoteVolume: candle[7],
            tradesCount: 0, // OKX doesn't provide trade count in candle data
          }))
          .filter((record) => record.timestamp.getTime() >= targetStart);

        allResults.push(...batchResults);

        const oldestTimestamp = parseInt(candles[candles.length - 1][0], 10);
        const exhaustedBatch = candles.length < 100;

        if (oldestTimestamp <= targetStart || exhaustedBatch) {
          break;
        }

        if (oldestTimestamp >= currentAfter) {
          logger.warn(`Detected non-decreasing pagination while fetching OKX OHLCV for ${symbol}`);
          break;
        }

        currentAfter = oldestTimestamp - 1;
        safetyCounter += 1;

        // Small delay between pagination requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.debug(`Fetched ${allResults.length} OHLCV records for ${symbol}`);
      return allResults;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch OHLCV for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch OHLCV for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch OHLCV history for multiple symbols with rate limiting
   *
   * OKX Rate Limits:
   * - /api/v5/market/history-candles endpoint: 20 requests per 2 seconds
   * - Conservative delay: 600ms (100 requests/min) to stay well within limits
   */
  async getOHLCVBatch(
    symbols: string[],
    bar: string = '1H',
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOHLCVData[]) => Promise<void>
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from OKX`);

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
          logger.info(`[API] Fetching OHLCV ${symbol} from OKX...`);
          const data = await this.getOHLCV(symbol, bar);

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
            logger.error(`IP banned by OKX`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} OHLCV records from OKX`);

    return results;
  }

  /**
   * Fetch open interest history for a specific instrument
   * Endpoint: GET /api/v5/rubik/stat/contracts/open-interest-history
   *
   * API Documentation:
   * - Returns historical open interest data
   * - Supports periods: 5m, 1H, 4H, 1D
   * - Returns up to 100 data points per request
   * - Uses 'end' parameter for pagination (fetching older data)
   *
   * Rate Limits:
   * - 20 requests per 2 seconds (~600 req/min)
   *
   * Response Format:
   * - Array of arrays: [timestamp, oi_contracts, oi_base_ccy, oi_usd_value]
   *
   * @param instId - Instrument ID (e.g., "BTC-USDT-SWAP")
   * @param period - Time period (default: '1H')
   * @returns Array of open interest data points
   */
  async getOpenInterest(instId: string, period: string = '1H'): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest history for ${instId} from OKX`);

      // Calculate time range: 480 hours ago (same as funding/OHLCV)
      const hoursAgo = 480;
      const targetStart = Date.now() - hoursAgo * 60 * 60 * 1000;

      const allResults: FetchedOIData[] = [];
      let currentEnd: string | undefined = undefined;
      let safetyCounter = 0;
      const maxBatches = 20; // 20 * 100 records

      while (safetyCounter < maxBatches) {
        const params: any = {
          instId,
          period,
          limit: '100',
        };

        if (currentEnd) {
          params.end = currentEnd;
        }

        const data = await this.requestWithRetry<OKXOpenInterestHistoryResponse>(
          'get',
          '/api/v5/rubik/stat/contracts/open-interest-history',
          { params }
        );

        // Check if request was successful
        if (data.code !== '0') {
          throw new Error(`OKX API error: ${data.msg}`);
        }

        const oiData = data.data;
        if (!oiData || !Array.isArray(oiData) || oiData.length === 0) {
          break; // No more data
        }

        // Parse the array format: [timestamp, oi_contracts, oi_base_ccy, oi_usd_value]
        const batchResults: FetchedOIData[] = oiData
          .map((point) => ({
            asset: instId,
            timestamp: new Date(parseInt(point[0])),
            openInterest: point[1], // OI in contracts
            openInterestValue: point[3], // OI value in USD
          }))
          .filter((record) => record.timestamp.getTime() >= targetStart);

        allResults.push(...batchResults);

        const oldestTimestamp = parseInt(oiData[oiData.length - 1][0]);
        const exhaustedBatch = oiData.length < 100;

        if (oldestTimestamp <= targetStart || exhaustedBatch) {
          break;
        }

        // Update currentEnd for next page (use oldest timestamp from current batch)
        currentEnd = oldestTimestamp.toString();
        safetyCounter++;

        // Small delay between pagination requests
        await this.sleep(200);
      }

      // Deduplicate by timestamp (OKX API may return duplicates across pagination boundaries)
      const uniqueResults = Array.from(
        new Map(
          allResults.map(item => [item.timestamp.getTime(), item])
        ).values()
      );

      logger.debug(`Fetched ${uniqueResults.length} unique open interest history records for ${instId} (${allResults.length} total, ${allResults.length - uniqueResults.length} duplicates removed)`);
      return uniqueResults;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch open interest history for ${instId}: ${errorMsg}`);
      throw new Error(`Failed to fetch open interest history for ${instId}: ${errorMsg}`);
    }
  }

  /**
   * Fetch open interest for multiple instruments with rate limiting
   *
   * OKX Rate Limits:
   * - /api/v5/public/open-interest endpoint: 20 requests per 2 seconds
   * - Conservative delay: 600ms (100 requests/min) to stay well within limits
   */
  async getOpenInterestBatch(
    instIds: string[],
    period: string = '1H',
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOIData[]) => Promise<void>
  ): Promise<Map<string, FetchedOIData[]>> {
    void period; // fix unused var
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${instIds.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      instIds,
      async (instId) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${instId} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching OI ${instId} from OKX...`);
          const data = await this.getOpenInterest(instId, period);

          if (onItemFetched) {
            await onItemFetched(instId, data);
          } else {
            results.set(instId, data);
          }

          logger.info(`[API] ✓ ${instId}: ${data.length} OI records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${instId}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by OKX`, errorMsg);
            return;
          }

          logger.error(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch open interest for ${instId}`, errorMsg);
          if (!onItemFetched) {
            results.set(instId, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(instId, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} open interest records from OKX`);

    return results;
  }

  /**
   * Fetch Long/Short Ratio
   * Endpoint: GET /api/v5/rubik/stat/contracts/long-short-account-ratio
   *
   * API Documentation:
   * - Returns long/short account ratio
   * - Supports periods: 5m, 1H, 4H, 1D
   * - Max limit: 100 records per request
   *
   * Rate Limits:
   * - 20 requests per 2 seconds
   */
  async getLongShortRatio(
    instId: string,
    period: string = '1H'
  ): Promise<FetchedLongShortRatioData[]> {
    try {
      logger.debug(`Fetching L/S Ratio for ${instId} from OKX`);

      // For 30 days of historical data, use 1D period with limit=30
      // Similar to OI, this is the most reliable way to get history
      const baseCurrency = instId.split('-')[0];

      if (!baseCurrency) {
        throw new Error(`Unable to derive currency parameter from instId: ${instId}`);
      }

      const data = await this.requestWithRetry<OKXLongShortRatioResponse>(
        'get',
        '/api/v5/rubik/stat/contracts/long-short-account-ratio',
        {
          params: {
            ccy: baseCurrency,
            period: '1D', // Daily data for 30 days
            limit: '30',
          },
        }
      );

      if (data.code !== '0') {
        throw new Error(`OKX API error: ${data.msg}`);
      }

      const ratioData = data.data;
      if (!ratioData || !Array.isArray(ratioData) || ratioData.length === 0) {
        logger.warn(`No L/S ratio data found for ${instId}`);
        return [];
      }

      // Format: [timestamp, ratio]
      // OKX only gives the ratio, not the individual percentages.
      // We can infer percentages: Ratio = Longs / Shorts
      // Longs + Shorts = 1
      // Longs = Ratio * Shorts
      // Ratio * Shorts + Shorts = 1 => Shorts * (Ratio + 1) = 1 => Shorts = 1 / (Ratio + 1)
      // Longs = 1 - Shorts
      const results: FetchedLongShortRatioData[] = ratioData.map((point) => {
        const ratio = parseFloat(point[1]);
        const shorts = 1 / (ratio + 1);
        const longs = 1 - shorts;

        return {
          asset: instId,
          timestamp: new Date(parseInt(point[0])),
          longRatio: longs,
          shortRatio: shorts,
          longAccount: longs, // Inferred
          shortAccount: shorts, // Inferred
          platform: 'okx',
          type: 'global_account',
          period,
        };
      });

      logger.debug(`Fetched ${results.length} L/S ratio records for ${instId}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch L/S ratio for ${instId}: ${errorMsg}`);
      throw new Error(`Failed to fetch L/S ratio for ${instId}: ${errorMsg}`);
    }
  }

  /**
   * Fetch L/S Ratio history for multiple symbols with rate limiting
   */
  async getLongShortRatioBatch(
    instIds: string[],
    period: string = '1H',
    delayMs: number = 600,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedLongShortRatioData[]) => Promise<void>
  ): Promise<Map<string, FetchedLongShortRatioData[]>> {
    const results = new Map<string, FetchedLongShortRatioData[]>();

    logger.info(`Fetching L/S Ratio data for ${instIds.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      instIds,
      async (instId) => {
        if (this.isBanned) return;

        try {
          logger.info(`[API] Fetching L/S Ratio ${instId} from OKX...`);
          const data = await this.getLongShortRatio(instId, period);

          if (onItemFetched) {
            await onItemFetched(instId, data);
          } else {
            results.set(instId, data);
          }

          logger.info(`[API] ✓ ${instId}: ${data.length} L/S records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          if (errorMsg.includes('IP_BANNED')) {
            return;
          }
          logger.error(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
          if (!onItemFetched) results.set(instId, []);
        } finally {
          processed++;
          if (onProgress) onProgress(instId, processed);
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    return results;
  }

  /**
   * Fetch liquidation orders
   * Endpoint: GET /api/v5/public/liquidation-orders
   *
   * API Documentation:
   * - Returns liquidation orders for a specific instrument
   * - Provides data on forced liquidations
   * - Max 100 records per request
   *
   * Rate Limits:
   * - 20 requests per 2 seconds per IP
   */
  async getLiquidations(
    instId: string,
    state?: string,
    limit: number = 100
  ): Promise<FetchedLiquidationData[]> {
    try {
      logger.debug(`Fetching liquidations for ${instId} from OKX`);

      const params: any = {
        instType: 'SWAP',
        uly: instId.replace('-SWAP', ''),
        limit: limit.toString(),
      };

      if (state) {
        params.state = state; // 'filled' or 'unfilled'
      }

      const data = await this.requestWithRetry<OKXLiquidationResponse>('get', '/api/v5/public/liquidation-orders', {
        params,
      });

      if (data.code !== '0') {
        throw new Error(`OKX API error: ${data.msg}`);
      }

      if (!data.data || data.data.length === 0) {
        logger.debug(`No liquidation data found for ${instId}`);
        return [];
      }

      const results: FetchedLiquidationData[] = [];
      
      for (const item of data.data) {
        if (!item.details) continue;
        
        for (const detail of item.details) {
          const quantity = parseFloat(detail.sz);
          const price = parseFloat(detail.bkPx);
          
          results.push({
            asset: detail.instId,
            timestamp: new Date(parseInt(detail.ts)),
            side: detail.posSide === 'long' ? 'Long' : 'Short',
            price,
            quantity,
            volumeUsd: quantity * price,
            platform: 'okx',
          });
        }
      }

      logger.debug(`Fetched ${results.length} liquidation records for ${instId}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch liquidations for ${instId}: ${errorMsg}`);
      throw new Error(`Failed to fetch liquidations for ${instId}: ${errorMsg}`);
    }
  }

  /**
   * Fetch liquidations for multiple instruments with rate limiting
   */
  async getLiquidationsBatch(
    instIds: string[],
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

    logger.info(`Fetching liquidation data for ${instIds.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, options.concurrency ?? 1);

    await runPromisePool(
      instIds,
      async (instId) => {
        if (this.isBanned) return;

        try {
          logger.info(`[API] Fetching Liquidations ${instId} from OKX...`);
          const data = await this.getLiquidations(instId, options.state ?? 'filled', 100);

          if (onItemFetched) {
            await onItemFetched(instId, data);
          } else {
            results.set(instId, data);
          }

          logger.info(`[API] ✓ ${instId}: ${data.length} liquidation records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          if (errorMsg.includes('IP_BANNED')) {
            return;
          }
          logger.error(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
          if (!onItemFetched) results.set(instId, []);
        } finally {
          processed++;
          if (onProgress) onProgress(instId, processed);
        }
      },
      { concurrency: safeConcurrency, delayMs: options.delayMs ?? 600, rateLimiter, weight: 1 }
    );

    return results;
  }
}

export default OKXClient;
