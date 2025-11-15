import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  JupiterMarket,
  JupiterMarketsResponse,
  FetchedFundingData,
} from './types';

export class JupiterClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Jupiter API base URL
    // Documentation: https://station.jup.ag/docs/apis/swap-api
    // NOTE: Jupiter is primarily a spot DEX aggregator on Solana
    // Perpetuals may be available via Jupiter Perps in the future
    this.baseURL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Jupiter API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available markets from Jupiter
   *
   * NOTE: Jupiter is primarily a spot trading aggregator
   * TODO: Update when Jupiter Perps API becomes available
   * - Check https://station.jup.ag/docs for perpetuals support
   * - May need to integrate with a different endpoint/protocol
   */
  async getAssets(): Promise<JupiterMarket[]> {
    try {
      logger.info('Fetching assets from Jupiter');

      // TODO: Replace with actual Jupiter Perps endpoint when available
      // Current Jupiter API is for spot trading
      logger.warn('Jupiter perpetuals support not yet implemented');
      return [];

      // Placeholder for future implementation:
      // const response = await this.client.get<JupiterMarketsResponse>('/markets');
      // return response.data.markets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Jupiter', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific market
   *
   * NOTE: Jupiter is primarily a spot trading aggregator
   * TODO: Implement when Jupiter Perps API becomes available
   * - Jupiter may implement perpetuals with funding rates in the future
   * - Check Jupiter documentation for updates on perps support
   *
   * Rate Limits:
   * - TODO: Add actual rate limits when API is available
   */
  async getFundingHistory(market: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${market} from Jupiter`);

      // TODO: Implement when Jupiter Perps API is available
      logger.warn('Jupiter perpetuals funding history not yet implemented');
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
   * TODO: Implement when Jupiter Perps API becomes available
   */
  async getFundingHistoryBatch(
    markets: string[],
    delayMs: number = 100,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Jupiter perpetuals not yet supported - returning empty results for ${markets.length} markets`);

    // Return empty results for all markets
    for (const market of markets) {
      results.set(market, []);
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default JupiterClient;
