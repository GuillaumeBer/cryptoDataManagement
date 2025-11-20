import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import { RateLimiter } from '../../utils/rateLimiter';
import {
  DyDxAsset,
  DyDxMarketsResponse,
  DyDxHistoricalFundingResponse,
  FetchedFundingData,
  DyDxCandlesResponse,
  FetchedOHLCVData,
  FetchedOIData,
} from './types';

/**
 * DyDx V4 Indexer API Client
 *
 * Documentation: https://docs.dydx.exchange/api_integration-indexer/indexer_api
 *
 * Funding Rate Information:
 * - DyDx V4 uses 1-hour funding intervals
 * - Funding is continuous and paid/received every hour
 * - Historical funding rate data available via /v4/historicalFunding/{ticker}
 *
 * Rate Limits:
 * - Public endpoints: Generally permissive, no strict documented limits
 * - Conservative delay: 100ms between requests to be respectful
 */
export class DyDxClient {
  private client: AxiosInstance;
  private baseURL: string;
  private isBanned: boolean = false;

  constructor() {
    // DyDx V4 Indexer API base URL
    this.baseURL = process.env.DYDX_API_URL || 'https://indexer.dydx.trade/v4';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('DyDx V4 Indexer API client initialized', { baseURL: this.baseURL });
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
   * - Throws IP_BANNED error on HTTP 418 or 403 (IP banned)
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
            logger.error(`IP BANNED by DyDx: ${banMsg}`);
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
        return `${axiosError.message}: ${data.errors || JSON.stringify(data).substring(0, 200)}`;
      }
      return axiosError.message;
    }
    return String(error);
  }

  /**
   * Fetch all available perpetual markets from DyDx V4
   *
   * Endpoint: GET /v4/perpetualMarkets
   * Documentation: https://docs.dydx.exchange/api_integration-indexer/indexer_api#get-perpetual-markets
   *
   * Returns: Object with market ticker as key and market data as value
   */
  async getAssets(): Promise<DyDxAsset[]> {
    try {
      logger.info('Fetching perpetual markets from DyDx V4');

      const data = await this.requestWithRetry<DyDxMarketsResponse>('get', '/perpetualMarkets');

      // DyDx returns markets as an object with ticker as key
      const markets = Object.values(data.markets);

      // Filter for active markets only
      const activeMarkets = markets.filter(
        (m) => m.status === 'ACTIVE'
      );

      logger.info(`Fetched ${activeMarkets.length} active perpetual markets from DyDx V4`);
      return activeMarkets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from DyDx V4', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific market
   *
   * Endpoint: GET /v4/historicalFunding/{ticker}
   * Documentation: https://docs.dydx.exchange/api_integration-indexer/indexer_api#get-historical-funding
   *
   * DyDx V4 Funding Rate Details:
   * - Funding occurs every 1 hour (hourly funding)
   * - Each funding period is 1 hour (60 minutes)
   * - Historical data: we fetch 480 hours = 480 funding periods
   *
   * Query Parameters:
   * - effectiveBeforeOrAt: ISO 8601 timestamp (get data before or at this time)
   * - effectiveBeforeOrAtHeight: Block height (alternative to timestamp)
   * - limit: max 100 records per request (default 100)
   *
   * Note: DyDx returns data in reverse chronological order (newest first)
   * We may need multiple requests to get all 480 periods
   */
  async getFundingHistory(ticker: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${ticker} from DyDx V4`);

      // Calculate time range: 480 hours ago to now
      // This gives us 480 funding periods (1h each)
      const hoursAgo = 480;
      const now = new Date();
      const startTime = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));

      // DyDx returns data in reverse chronological order (newest first)
      // and limits to 100 records per request
      const allResults: FetchedFundingData[] = [];
      let effectiveBeforeOrAt = now.toISOString();
      let hasMore = true;

      // Fetch up to 100 records at a time until we have enough or no more data
      while (hasMore && allResults.length < 480) {
        const data = await this.requestWithRetry<DyDxHistoricalFundingResponse>('get', `/historicalFunding/${ticker}`, {
          params: {
            effectiveBeforeOrAt,
            limit: 100,
          },
        });

        const fundingData = data.historicalFunding;
        if (!fundingData || !Array.isArray(fundingData) || fundingData.length === 0) {
          logger.debug(`No more funding data found for ${ticker}`);
          hasMore = false;
          break;
        }

        // Convert to our standard format
        const batchResults: FetchedFundingData[] = fundingData.map((point) => ({
          asset: ticker,
          timestamp: new Date(point.effectiveAt),
          fundingRate: point.rate,
          premium: '0', // DyDx doesn't provide premium separately
        }));

        // Filter out data older than our start time
        const filteredResults = batchResults.filter(
          (r) => r.timestamp >= startTime
        );

        allResults.push(...filteredResults);

        // If we got less than 100 records, we've reached the end
        if (fundingData.length < 100) {
          hasMore = false;
        } else {
          // Set 'effectiveBeforeOrAt' to the oldest timestamp we just received for next page
          const oldestTimestamp = new Date(fundingData[fundingData.length - 1].effectiveAt);

          // If oldest timestamp is before our start time, we're done
          if (oldestTimestamp < startTime) {
            hasMore = false;
          } else {
            effectiveBeforeOrAt = oldestTimestamp.toISOString();
            // Small delay between pagination requests
            await this.sleep(50);
          }
        }
      }

      logger.debug(`Fetched ${allResults.length} funding rate records for ${ticker}`);
      return allResults;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch funding history for ${ticker}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${ticker}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple markets with rate limiting
   *
   * Rate Limiting Strategy:
   * - DyDx has permissive rate limits for public endpoints
   * - We use 100ms delay to be respectful and avoid overwhelming the server
   *
   * @param tickers - Array of market tickers (e.g., ["BTC-USD", "ETH-USD"])
   * @param delayMs - Delay between requests in milliseconds (default: 100ms)
   * @param onProgress - Optional callback for progress tracking
   * @returns Map of ticker to funding data array
   */
  async getFundingHistoryBatch(
    tickers: string[],
    delayMs: number = 100,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedFundingData[]) => Promise<void>
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${tickers.length} assets from DyDx V4`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      tickers,
      async (ticker) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${ticker} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching ${ticker} from DyDx V4...`);
          const data = await this.getFundingHistory(ticker);

          if (onItemFetched) {
            await onItemFetched(ticker, data);
          } else {
            results.set(ticker, data);
          }

          logger.info(`[API] ✓ ${ticker}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${ticker}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by DyDx`, errorMsg);
            return; // Stop processing this and future symbols
          }

          logger.error(`[API] ✗ ${ticker}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${ticker}`, errorMsg);

          // Store empty array for failed tickers to maintain consistency
          if (!onItemFetched) {
            results.set(ticker, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(ticker, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from DyDx V4`);

    return results;
  }

  /**
   * Fetch OHLCV (candle) history for a specific symbol
   * Endpoint: GET /v4/candles/perpetualMarkets/{ticker}
   *
   * API Documentation:
   * - Resolution: "1HOUR" for 1-hour candles
   * - Can use fromISO and toISO for time range
   *
   * Rate Limits:
   * - Public endpoints: Conservative approach
   */
  async getOHLCV(symbol: string, resolution: string = '1HOUR'): Promise<FetchedOHLCVData[]> {
    try {
      logger.debug(`Fetching OHLCV history for ${symbol} from DyDx`);

      // Calculate time range: 480 hours ago to match funding rate depth
      const hoursAgo = 480;
      const fromISO = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
      const toISO = new Date().toISOString();

      const data = await this.requestWithRetry<DyDxCandlesResponse>('get', `/candles/perpetualMarkets/${symbol}`, {
        params: {
          resolution,
          fromISO,
          toISO,
          limit: 500, // Fetch sufficient data
        },
      });

      const candles = data.candles;
      if (!candles || !Array.isArray(candles)) {
        logger.warn(`No OHLCV data found for ${symbol}`);
        return [];
      }

      const results: FetchedOHLCVData[] = candles.map((candle) => ({
        asset: symbol,
        timestamp: new Date(candle.startedAt),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.baseTokenVolume,
        quoteVolume: candle.usdVolume,
        tradesCount: candle.trades,
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
   * DyDx Rate Limits:
   * - OHLCV endpoints have stricter rate limits than funding endpoints
   * - Use 1 concurrent request with 500ms delay to avoid 429 errors
   */
  async getOHLCVBatch(
    symbols: string[],
    resolution: string = '1HOUR',
    delayMs: number = 500,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOHLCVData[]) => Promise<void>
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from DyDx`);

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
          logger.info(`[API] Fetching OHLCV ${symbol} from DyDx...`);
          const data = await this.getOHLCV(symbol, resolution);

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
            logger.error(`IP banned by DyDx`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} OHLCV records from DyDx`);

    return results;
  }

  /**
   * Fetch open interest history for a specific market
   *
   * Note: DyDx V4 provides OI data embedded in candle responses via `startingOpenInterest`
   * This method fetches candles and extracts the OI data
   *
   * Endpoint: GET /v4/candles/perpetualMarkets/{ticker}
   */
  async getOpenInterest(ticker: string, resolution: string = '1HOUR'): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest for ${ticker} from DyDx`);

      // Fetch market info to get contract specifications (stepSize)
      const marketsData = await this.requestWithRetry<DyDxMarketsResponse>('get', '/perpetualMarkets');
      const marketInfo = marketsData.markets[ticker];

      if (!marketInfo) {
        logger.warn(`Market info not found for ${ticker}`);
        return [];
      }

      // stepSize represents the contract size (e.g., 1 BTC for BTC-USD)
      const contractSize = parseFloat(marketInfo.stepSize);

      // Calculate time range: 480 hours ago to match funding rate and OHLCV depth
      const hoursAgo = 480;
      const fromISO = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
      const toISO = new Date().toISOString();

      const data = await this.requestWithRetry<DyDxCandlesResponse>('get', `/candles/perpetualMarkets/${ticker}`, {
        params: {
          resolution,
          fromISO,
          toISO,
          limit: 500, // Fetch sufficient data
        },
      });

      const candles = data.candles;
      if (!candles || !Array.isArray(candles)) {
        logger.warn(`No candle data found for ${ticker}`);
        return [];
      }

      const results: FetchedOIData[] = candles.map((candle) => {
        const contractCount = parseFloat(candle.startingOpenInterest);
        const price = parseFloat(candle.close);

        // Calculate OI value: number of contracts × price × contract size
        const oiValue = contractCount * price * contractSize;

        return {
          asset: ticker,
          timestamp: new Date(candle.startedAt),
          openInterest: candle.startingOpenInterest,
          openInterestValue: isNaN(oiValue) ? undefined : oiValue.toString(),
        };
      });

      logger.debug(`Fetched ${results.length} open interest records for ${ticker} (contract size: ${contractSize})`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch open interest for ${ticker}: ${errorMsg}`);
      throw new Error(`Failed to fetch open interest for ${ticker}: ${errorMsg}`);
    }
  }

  /**
   * Helper method to fetch open interest with pre-determined contract size
   * Used by getOpenInterestBatch to avoid repeated market info fetches
   */
  private async getOpenInterestWithContractSize(
    ticker: string,
    contractSize: number,
    resolution: string = '1HOUR'
  ): Promise<FetchedOIData[]> {
    // Calculate time range: 480 hours ago to match funding rate and OHLCV depth
    const hoursAgo = 480;
    const fromISO = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
    const toISO = new Date().toISOString();

    const data = await this.requestWithRetry<DyDxCandlesResponse>('get', `/candles/perpetualMarkets/${ticker}`, {
      params: {
        resolution,
        fromISO,
        toISO,
        limit: 500, // Fetch sufficient data
      },
    });

    const candles = data.candles;
    if (!candles || !Array.isArray(candles)) {
      logger.warn(`No candle data found for ${ticker}`);
      return [];
    }

    const results: FetchedOIData[] = candles.map((candle) => {
      const contractCount = parseFloat(candle.startingOpenInterest);
      const price = parseFloat(candle.close);

      // Calculate OI value: number of contracts × price × contract size
      const oiValue = contractCount * price * contractSize;

      return {
        asset: ticker,
        timestamp: new Date(candle.startedAt),
        openInterest: candle.startingOpenInterest,
        openInterestValue: isNaN(oiValue) ? undefined : oiValue.toString(),
      };
    });

    logger.debug(`Fetched ${results.length} open interest records for ${ticker} (contract size: ${contractSize})`);
    return results;
  }

  /**
   * Fetch open interest for multiple markets with rate limiting
   *
   * DyDx Rate Limits:
   * - Same endpoint as OHLCV, use conservative delay
   *
   * Optimized to fetch market info once and reuse for all tickers
   */
  async getOpenInterestBatch(
    tickers: string[],
    resolution: string = '1HOUR',
    delayMs: number = 500,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOIData[]) => Promise<void>
  ): Promise<Map<string, FetchedOIData[]>> {
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${tickers.length} assets from DyDx`);

    // Fetch market info once for all tickers (optimization)
    logger.info('Fetching market info for contract sizes...');
    const marketsData = await this.requestWithRetry<DyDxMarketsResponse>('get', '/perpetualMarkets');
    const markets = marketsData.markets;

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      tickers,
      async (ticker) => {
        // Check if IP is banned before processing
        if (this.isBanned) {
          logger.warn(`[API] Skipping ${ticker} - IP is banned`);
          return;
        }

        try {
          logger.info(`[API] Fetching OI ${ticker} from DyDx...`);

          // Use the pre-fetched market info
          const marketInfo = markets[ticker];
          if (!marketInfo) {
            logger.warn(`Market info not found for ${ticker}`);

            if (onItemFetched) {
              // Skip if not found
            } else {
              results.set(ticker, []);
            }
            return;
          }

          const contractSize = parseFloat(marketInfo.stepSize);
          const data = await this.getOpenInterestWithContractSize(ticker, contractSize, resolution);

          if (onItemFetched) {
            await onItemFetched(ticker, data);
          } else {
            results.set(ticker, data);
          }

          logger.info(`[API] ✓ ${ticker}: ${data.length} OI records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);

          // Check if this is an IP ban error
          if (errorMsg.includes('IP_BANNED')) {
            logger.error(`[API] ✗ ${ticker}: IP BANNED - stopping all fetches`);
            logger.error(`IP banned by DyDx`, errorMsg);
            return;
          }

          logger.error(`[API] ✗ ${ticker}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch open interest for ${ticker}`, errorMsg);
          if (!onItemFetched) {
            results.set(ticker, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(ticker, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 1 }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} open interest records from DyDx`);

    return results;
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default DyDxClient;
