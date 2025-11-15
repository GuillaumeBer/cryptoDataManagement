import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  OKXInstrument,
  OKXInstrumentsResponse,
  OKXFundingRateHistoryResponse,
  FetchedFundingData,
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
  async getAssets(): Promise<OKXInstrument[]> {
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
      console.error(`Failed to fetch funding history for ${instId}:`, errorMsg);
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${instIds.length} assets from OKX`);

    let processed = 0;
    for (const instId of instIds) {
      try {
        console.log(`[API] Fetching ${instId} from OKX...`);
        const data = await this.getFundingHistory(instId);
        results.set(instId, data);
        console.log(`[API] ✓ ${instId}: ${data.length} records`);

        processed++;
        if (onProgress) {
          onProgress(instId, processed);
        }

        // Rate limiting: wait before next request
        if (processed < instIds.length && delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${instId}`, errorMsg);

        // Store empty array for failed instruments to maintain consistency
        results.set(instId, []);
        processed++;

        if (onProgress) {
          onProgress(instId, processed);
        }

        // Continue with delay even after error
        if (processed < instIds.length && delayMs > 0) {
          await this.sleep(delayMs);
        }
      }
    }

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
}

export default OKXClient;
