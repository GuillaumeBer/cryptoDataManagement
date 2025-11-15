import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  DyDxMarket,
  DyDxMarketsResponse,
  DyDxHistoricalFundingResponse,
  FetchedFundingData,
} from './types';

export class DyDxClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // DyDx V4 API base URL
    // Documentation: https://docs.dydx.exchange/api_integration-indexer/indexer_api
    this.baseURL = process.env.DYDX_API_URL || 'https://indexer.dydx.trade/v4';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('DyDx V4 API client initialized', { baseURL: this.baseURL });
  }

  /**
   * Safely extract error message from axios error
   */
  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      return axiosError.response?.data
        ? `${axiosError.message}: ${JSON.stringify(axiosError.response.data).substring(0, 200)}`
        : axiosError.message;
    }
    return String(error);
  }

  /**
   * Fetch all available perpetual markets from DyDx V4
   * Endpoint: GET /markets
   *
   * TODO: Implement based on DyDx V4 API documentation
   * - Filter for active perpetual markets
   * - DyDx V4 uses ticker format like "BTC-USD", "ETH-USD"
   */
  async getAssets(): Promise<DyDxMarket[]> {
    try {
      logger.info('Fetching assets from DyDx V4');

      // TODO: Replace with actual DyDx V4 endpoint
      // Example: GET /markets
      const response = await this.client.get<DyDxMarketsResponse>('/markets');

      // TODO: Adjust filtering based on actual response structure
      const markets = Object.values(response.data.markets).filter(
        (m) => m.status === 'ACTIVE'
      );

      logger.info(`Fetched ${markets.length} perpetual markets from DyDx V4`);
      return markets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from DyDx V4', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific market
   * Endpoint: GET /historicalFunding/{ticker}
   *
   * DyDx V4 funding happens every 1 hour (hourly funding)
   *
   * TODO: Verify API endpoint and parameters from official documentation
   * - DyDx V4 uses ticker format like "BTC-USD"
   * - Historical depth: 480 hours (480 funding periods at 1h intervals)
   * - DyDx funding is hourly, similar to Hyperliquid
   *
   * Rate Limits:
   * - TODO: Add actual rate limits from DyDx documentation
   */
  async getFundingHistory(ticker: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${ticker} from DyDx V4`);

      // Calculate time range: 480 hours ago
      const hoursAgo = 480;
      const effectiveBefore = new Date().toISOString();
      const effectiveAfter = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();

      // TODO: Replace with actual DyDx V4 endpoint
      // Example: GET /historicalFunding/{ticker}
      const response = await this.client.get<DyDxHistoricalFundingResponse>(`/historicalFunding/${ticker}`, {
        params: {
          effectiveBefore,
          effectiveAfter,
          limit: 100, // TODO: Verify max limit
        },
      });

      const fundingData = response.data.historicalFunding;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${ticker}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: ticker,
        timestamp: new Date(point.effectiveAt),
        fundingRate: point.rate,
        premium: '0', // TODO: Check if DyDx provides premium separately
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${ticker}`);
      return results;
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
   * TODO: Add actual DyDx rate limits
   * - Default delay: 100ms (placeholder, adjust based on actual limits)
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

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${ticker}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${ticker}`, errorMsg);
        results.set(ticker, []);
        processed++;
        if (onProgress) {
          onProgress(ticker, processed);
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default DyDxClient;
