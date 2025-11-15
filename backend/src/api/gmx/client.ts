import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  GMXMarket,
  GMXMarketsResponse,
  GMXFundingRateResponse,
  FetchedFundingData,
} from './types';

export class GMXClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // GMX Stats API base URL
    // Documentation: https://gmxio.gitbook.io/gmx/
    // GMX v2 on Arbitrum and Avalanche
    this.baseURL = process.env.GMX_API_URL || 'https://api.gmx.io';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('GMX API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available perpetual markets from GMX
   *
   * GMX v2 markets on Arbitrum and Avalanche
   *
   * TODO: Implement based on GMX API documentation
   * - GMX may require on-chain queries or use of their subgraph
   * - Consider using The Graph for GMX data
   * - Markets use format like "BTC/USD", "ETH/USD"
   */
  async getAssets(): Promise<GMXMarket[]> {
    try {
      logger.info('Fetching assets from GMX');

      // TODO: Replace with actual GMX endpoint or subgraph query
      // GMX typically requires querying their subgraph on The Graph
      // Example: Query GMX v2 subgraph for markets

      logger.warn('GMX markets fetching requires implementation - may need subgraph integration');
      return [];

      // Placeholder for future implementation:
      // const response = await this.client.get<GMXMarketsResponse>('/markets');
      // return response.data.markets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from GMX', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific market
   *
   * GMX funding rates are continuous (not discrete intervals)
   * - Funding is paid/received every hour
   * - Rate is calculated based on utilization and borrowing fees
   *
   * TODO: Verify API endpoint and parameters
   * - GMX may require subgraph queries for historical data
   * - Consider using The Graph's GMX v2 subgraph
   * - Historical depth: 480 hours (480 funding periods at 1h intervals)
   *
   * Rate Limits:
   * - TODO: Add actual rate limits (depends on data source - Graph, Stats API, etc.)
   */
  async getFundingHistory(market: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${market} from GMX`);

      // TODO: Implement actual GMX funding rate fetching
      // This may require:
      // 1. Querying GMX subgraph on The Graph
      // 2. Using GMX Stats API if available
      // 3. On-chain queries to GMX contracts

      logger.warn('GMX funding history requires implementation - may need subgraph integration');
      return [];

      // Placeholder for future implementation
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      console.error(`Failed to fetch funding history for ${market}:`, errorMsg);
      logger.error(`Failed to fetch funding history for ${market}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${market}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple markets with rate limiting
   *
   * TODO: Implement when GMX API/subgraph integration is complete
   * - Default delay: 100ms (placeholder)
   */
  async getFundingHistoryBatch(
    markets: string[],
    delayMs: number = 100,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${markets.length} assets from GMX`);

    let processed = 0;
    for (const market of markets) {
      try {
        console.log(`[API] Fetching ${market} from GMX...`);
        const data = await this.getFundingHistory(market);
        results.set(market, data);
        console.log(`[API] ✓ ${market}: ${data.length} records`);

        processed++;
        if (onProgress) {
          onProgress(market, processed);
        }

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${market}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${market}`, errorMsg);
        results.set(market, []);
        processed++;
        if (onProgress) {
          onProgress(market, processed);
        }
      }
    }

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from GMX`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default GMXClient;
