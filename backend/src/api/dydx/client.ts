import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  DyDxMarket,
  DyDxMarketsResponse,
  DyDxHistoricalFundingResponse,
  FetchedFundingData,
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
  async getAssets(): Promise<DyDxMarket[]> {
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
      console.error(`Failed to fetch funding history for ${ticker}:`, errorMsg);
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
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${tickers.length} assets from DyDx V4`);

    let processed = 0;
    for (const ticker of tickers) {
      try {
        console.log(`[API] Fetching ${ticker} from DyDx V4...`);
        const data = await this.getFundingHistory(ticker);
        results.set(ticker, data);
        console.log(`[API] ✓ ${ticker}: ${data.length} records`);

        processed++;
        if (onProgress) {
          onProgress(ticker, processed);
        }

        // Rate limiting: wait before next request
        if (processed < tickers.length && delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${ticker}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${ticker}`, errorMsg);

        // Store empty array for failed tickers to maintain consistency
        results.set(ticker, []);
        processed++;

        if (onProgress) {
          onProgress(ticker, processed);
        }

        // Continue with delay even after error
        if (processed < tickers.length && delayMs > 0) {
          await this.sleep(delayMs);
        }
      }
    }

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from DyDx V4`);

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
