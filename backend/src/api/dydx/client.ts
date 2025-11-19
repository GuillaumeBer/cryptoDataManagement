import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
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

      const response = await this.client.get<DyDxMarketsResponse>('/perpetualMarkets');

      // DyDx returns markets as an object with ticker as key
      const markets = Object.values(response.data.markets);

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
        const response = await this.client.get<DyDxHistoricalFundingResponse>(`/historicalFunding/${ticker}`, {
          params: {
            effectiveBeforeOrAt,
            limit: 100,
          },
        });

        const fundingData = response.data.historicalFunding;
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${tickers.length} assets from DyDx V4`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      tickers,
      async (ticker) => {
        try {
          logger.info(`[API] Fetching ${ticker} from DyDx V4...`);
          const data = await this.getFundingHistory(ticker);
          results.set(ticker, data);
          logger.info(`[API] ✓ ${ticker}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${ticker}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${ticker}`, errorMsg);

          // Store empty array for failed tickers to maintain consistency
          results.set(ticker, []);
        } finally {
          processed++;
          if (onProgress) {
            onProgress(ticker, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs }
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

      const response = await this.client.get<DyDxCandlesResponse>(`/candles/perpetualMarkets/${symbol}`, {
        params: {
          resolution,
          fromISO,
          toISO,
          limit: 500, // Fetch sufficient data
        },
      });

      const candles = response.data.candles;
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from DyDx`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching OHLCV ${symbol} from DyDx...`);
          const data = await this.getOHLCV(symbol, resolution);
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

      // Calculate time range: 480 hours ago to match funding rate and OHLCV depth
      const hoursAgo = 480;
      const fromISO = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
      const toISO = new Date().toISOString();

      const response = await this.client.get<DyDxCandlesResponse>(`/candles/perpetualMarkets/${ticker}`, {
        params: {
          resolution,
          fromISO,
          toISO,
          limit: 500, // Fetch sufficient data
        },
      });

      const candles = response.data.candles;
      if (!candles || !Array.isArray(candles)) {
        logger.warn(`No candle data found for ${ticker}`);
        return [];
      }

      const results: FetchedOIData[] = candles.map((candle) => ({
        asset: ticker,
        timestamp: new Date(candle.startedAt),
        openInterest: candle.startingOpenInterest,
        openInterestValue: undefined, // DyDx doesn't provide OI value separately
      }));

      logger.debug(`Fetched ${results.length} open interest records for ${ticker}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch open interest for ${ticker}: ${errorMsg}`);
      throw new Error(`Failed to fetch open interest for ${ticker}: ${errorMsg}`);
    }
  }

  /**
   * Fetch open interest for multiple markets with rate limiting
   *
   * DyDx Rate Limits:
   * - Same endpoint as OHLCV, use conservative delay
   */
  async getOpenInterestBatch(
    tickers: string[],
    resolution: string = '1HOUR',
    delayMs: number = 500,
    concurrency: number = 1,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedOIData[]>> {
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${tickers.length} assets from DyDx`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      tickers,
      async (ticker) => {
        try {
          logger.info(`[API] Fetching OI ${ticker} from DyDx...`);
          const data = await this.getOpenInterest(ticker, resolution);
          results.set(ticker, data);
          logger.info(`[API] ✓ ${ticker}: ${data.length} OI records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${ticker}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch open interest for ${ticker}`, errorMsg);
          results.set(ticker, []);
        } finally {
          processed++;
          if (onProgress) {
            onProgress(ticker, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs }
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
