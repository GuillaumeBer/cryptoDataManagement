import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  LighterAsset,
  LighterFundingRate,
  FetchedFundingData,
} from './types';

export class LighterClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // Lighter API base URL (from official docs: https://apidocs.lighter.xyz)
    this.baseURL = process.env.LIGHTER_API_URL || 'https://mainnet.zklighter.elliot.ai';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
    });

    logger.info('Lighter API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available perpetual futures assets from Lighter
   */
  async getAssets(): Promise<LighterAsset[]> {
    try {
      logger.info('Fetching assets from Lighter');

      // TODO: Update this endpoint based on official Lighter API documentation
      // This is a placeholder implementation
      const response = await this.client.get<{ symbols: LighterAsset[] }>('/api/v1/exchangeInfo');

      const assets = response.data.symbols.filter(
        (s) => s.status === 'TRADING'
      );

      logger.info(`Fetched ${assets.length} assets from Lighter`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Lighter', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific market
   *
   * Lighter Funding Rate Characteristics:
   * - Frequency: Hourly (funding paid every hour at hour marks)
   * - Calculation: TWAP of 60 minute-level premiums
   * - Range: Capped at [-0.5%, +0.5%]
   * - Formula: fundingRate = (premium/8) + interestRateComponent, then clamped
   *
   * API Endpoint: GET /api/v1/fundings (part of CandlestickApi)
   * Note: Parameters are inferred based on industry standards as they are not officially documented
   */
  async getFundingHistory(market: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${market} from Lighter`);

      // Calculate startTime: 480 hours ago to match Hyperliquid's depth
      // This gives 480 hourly funding rate data points
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      // Endpoint: GET /api/v1/fundings (confirmed from technical analysis)
      // Parameters are inferred (not documented):
      // - market_id: The market identifier (e.g., "ETH-PERP", "BTC-PERP")
      // - start_time: Unix timestamp in milliseconds
      // - end_time: Unix timestamp in milliseconds
      // - limit: Maximum number of records to return
      const response = await this.client.get<LighterFundingRate[]>('/api/v1/fundings', {
        params: {
          market_id: market,
          start_time: startTime,
          end_time: endTime,
          limit: 1000,
        },
      });

      const fundingData = response.data;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${market}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: market,
        timestamp: new Date(point.timestamp || point.fundingTime), // Handle both possible field names
        fundingRate: point.fundingRate || point.rate, // Handle both possible field names
        premium: point.premium || '0', // Lighter may or may not provide separate premium
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${market}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      console.error(`Failed to fetch funding history for ${market}:`, errorMsg);
      logger.error(`Failed to fetch funding history for ${market}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${market}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 100,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from Lighter`);

    let processed = 0;
    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol} from Lighter...`);
        const data = await this.getFundingHistory(symbol);
        results.set(symbol, data);
        console.log(`[API] ✓ ${symbol}: ${data.length} records`);

        processed++;
        // Emit progress callback
        if (onProgress) {
          onProgress(symbol, processed);
        }

        // Add delay to avoid rate limiting
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        console.log(`[API] ✗ ${symbol}: FAILED`);
        logger.error(`Failed to fetch funding history for ${symbol}`, error);
        results.set(symbol, []);
        processed++;
        if (onProgress) {
          onProgress(symbol, processed);
        }
      }
    }

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records from Lighter`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default LighterClient;
