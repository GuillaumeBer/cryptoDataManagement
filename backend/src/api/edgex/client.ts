import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  EdgeXAsset,
  EdgeXFundingRate,
  FetchedFundingData,
} from './types';

export class EdgeXClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // EdgeX API base URL
    this.baseURL = process.env.EDGEX_API_URL || 'https://pro.edgex.exchange';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('EdgeX API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available perpetual futures assets from EdgeX
   */
  async getAssets(): Promise<EdgeXAsset[]> {
    try {
      logger.info('Fetching assets from EdgeX');

      // TODO: Update this endpoint based on official EdgeX API documentation
      // Reference: https://edgex-1.gitbook.io/edgex-documentation/api
      const response = await this.client.get<{ symbols: EdgeXAsset[] }>('/api/v1/public/meta/symbols');

      const assets = response.data.symbols.filter(
        (s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL'
      );

      logger.info(`Fetched ${assets.length} assets from EdgeX`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from EdgeX', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific symbol
   * EdgeX has a Funding API under Public APIs
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${symbol}`);

      // Calculate time range: last 20 days
      const endTime = Date.now();
      const startTime = endTime - (20 * 24 * 60 * 60 * 1000);

      // TODO: Update this endpoint based on official EdgeX API documentation
      // Reference: https://edgex-1.gitbook.io/edgex-documentation/api
      const response = await this.client.get<EdgeXFundingRate[]>('/api/v1/public/funding/history', {
        params: {
          symbol,
          startTime,
          endTime,
          limit: 1000,
        },
      });

      const fundingData = response.data;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${symbol}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: symbol,
        timestamp: new Date(point.fundingTime),
        fundingRate: point.fundingRate,
        premium: '0', // EdgeX doesn't provide separate premium data
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      console.error(`Failed to fetch funding history for ${symbol}:`, errorMsg);
      logger.error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 150,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${symbols.length} assets from EdgeX`);

    let processed = 0;
    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol} from EdgeX...`);
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
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${symbol}`, errorMsg);
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from EdgeX`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default EdgeXClient;
