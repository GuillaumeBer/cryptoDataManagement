import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import {
  OKXAsset,
  OKXInstrumentsResponse,
  OKXFundingRateHistoryResponse,
  FetchedFundingData,
  OKXKlineResponse,
  FetchedOHLCVData,
  OKXOpenInterestResponse,
  OKXOpenInterestHistoryResponse,
  FetchedOIData,
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

      const response = await this.client.get<OKXInstrumentsResponse>('/api/v5/public/instruments', {
        params: {
          instType: 'SWAP', // Perpetual swaps
        },
      });

      // Check if request was successful
      if (response.data.code !== '0') {
        throw new Error(`OKX API error: ${response.data.msg}`);
      }

      // Filter for live USDT-settled linear perpetual contracts
      const assets = response.data.data.filter(
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

        const response = await this.client.get<OKXFundingRateHistoryResponse>('/api/v5/public/funding-rate-history', {
          params,
        });

        isFirstRequest = false;

        // Check if request was successful
        if (response.data.code !== '0') {
          throw new Error(`OKX API error: ${response.data.msg}`);
        }

        const fundingData = response.data.data;

        // Debug logging to see what OKX is returning
        if (!fundingData || !Array.isArray(fundingData) || fundingData.length === 0) {
          logger.warn(`No funding data from OKX for ${instId}. Response:`, {
            code: response.data.code,
            msg: response.data.msg,
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${instIds.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      instIds,
      async (instId) => {
        try {
          logger.info(`[API] Fetching ${instId} from OKX...`);
          const data = await this.getFundingHistory(instId);
          results.set(instId, data);
          logger.info(`[API] ✓ ${instId}: ${data.length} records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch funding history for ${instId}`, errorMsg);

          // Store empty array for failed instruments to maintain consistency
          results.set(instId, []);
        } finally {
          processed++;
          if (onProgress) {
            onProgress(instId, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs }
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
        const response = await this.client.get<OKXKlineResponse>('/api/v5/market/history-candles', {
          params: {
            instId: symbol,
            bar,
            after: currentAfter.toString(),
            limit: '100',
          },
        });

        // Check if request was successful
        if (response.data.code !== '0') {
          throw new Error(`OKX API error: ${response.data.msg}`);
        }

        const candles = response.data.data;
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching OHLCV ${symbol} from OKX...`);
          const data = await this.getOHLCV(symbol, bar);
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
    logger.info(`Fetched total of ${totalRecords} OHLCV records from OKX`);

    return results;
  }

  /**
   * Fetch open interest history for a specific instrument
   * Endpoint: GET /api/v5/rubik/stat/contracts/open-interest-history
   *
   * API Documentation:
   * - Returns historical open interest data
   * - Supports periods: 5m, 1H, 1D
   * - Returns up to 100 data points per request
   * - For 30 days of data, we use period='1D' with limit=30 (most efficient)
   *
   * Rate Limits:
   * - 20 requests per 2 seconds (~600 req/min)
   *
   * Response Format:
   * - Array of arrays: [timestamp, oi_contracts, oi_base_ccy, oi_usd_value]
   *
   * Note: The 'before' pagination parameter doesn't work reliably for this endpoint,
   * so we use daily granularity (1D) to fetch 30 days of data in a single request.
   *
   * @param instId - Instrument ID (e.g., "BTC-USDT-SWAP")
   * @param period - Time period (ignored, always uses '1D' for 30 days of data)
   * @returns Array of open interest data points (30 days of daily data)
   */
  async getOpenInterest(instId: string, period: string = '1H'): Promise<FetchedOIData[]> {
    try {
      logger.debug(`Fetching open interest history for ${instId} from OKX (30 days of daily data)`);

      // For 30 days of historical data, use 1D period with limit=30
      // This is the most efficient and reliable approach
      const response = await this.client.get<OKXOpenInterestHistoryResponse>(
        '/api/v5/rubik/stat/contracts/open-interest-history',
        {
          params: {
            instId,
            period: '1D', // Daily data for 30 days
            limit: '30',  // 30 days
          },
        }
      );

      // Check if request was successful
      if (response.data.code !== '0') {
        throw new Error(`OKX API error: ${response.data.msg}`);
      }

      const oiData = response.data.data;
      if (!oiData || !Array.isArray(oiData) || oiData.length === 0) {
        logger.warn(`No open interest history found for ${instId}`);
        return [];
      }

      // Parse the array format: [timestamp, oi_contracts, oi_base_ccy, oi_usd_value]
      const results: FetchedOIData[] = oiData.map((point) => ({
        asset: instId,
        timestamp: new Date(parseInt(point[0])),
        openInterest: point[1], // OI in contracts
        openInterestValue: point[3], // OI value in USD
      }));

      logger.debug(`Fetched ${results.length} open interest history records for ${instId} (spanning ~${results.length} days)`);
      return results;
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedOIData[]>> {
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest data for ${instIds.length} assets from OKX`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      instIds,
      async (instId) => {
        try {
          logger.info(`[API] Fetching OI ${instId} from OKX...`);
          const data = await this.getOpenInterest(instId, period);
          results.set(instId, data);
          logger.info(`[API] ✓ ${instId}: ${data.length} OI records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch open interest for ${instId}`, errorMsg);
          results.set(instId, []);
        } finally {
          processed++;
          if (onProgress) {
            onProgress(instId, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs }
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} open interest records from OKX`);

    return results;
  }
}

export default OKXClient;
