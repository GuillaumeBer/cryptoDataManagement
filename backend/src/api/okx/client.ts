import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  OKXInstrument,
  OKXInstrumentsResponse,
  OKXFundingRateResponse,
  FetchedFundingData,
} from './types';

export class OKXClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // OKX API base URL
    // Documentation: https://www.okx.com/docs-v5/en/
    this.baseURL = process.env.OKX_API_URL || 'https://www.okx.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('OKX API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available perpetual swaps from OKX
   * Endpoint: GET /api/v5/public/instruments
   *
   * TODO: Implement based on OKX API documentation
   * - instType: 'SWAP' for perpetual swaps
   * - Filter for active instruments
   */
  async getAssets(): Promise<OKXInstrument[]> {
    try {
      logger.info('Fetching assets from OKX');

      // TODO: Replace with actual OKX endpoint
      // Example: GET /api/v5/public/instruments?instType=SWAP
      const response = await this.client.get<OKXInstrumentsResponse>('/api/v5/public/instruments', {
        params: {
          instType: 'SWAP', // Perpetual swaps
        },
      });

      // TODO: Adjust filtering based on actual response structure
      const assets = response.data.data.filter(
        (inst) => inst.state === 'live'
      );

      logger.info(`Fetched ${assets.length} perpetual assets from OKX`);
      return assets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from OKX', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding rate history for a specific instrument
   * Endpoint: GET /api/v5/public/funding-rate-history
   *
   * OKX funding happens every 8 hours (00:00, 08:00, 16:00 UTC)
   *
   * TODO: Verify API endpoint and parameters from official documentation
   * - OKX uses instrument ID format like "BTC-USDT-SWAP"
   * - Historical depth: 480 hours (60 funding periods at 8h intervals)
   *
   * Rate Limits:
   * - TODO: Add actual rate limits from OKX documentation
   */
  async getFundingHistory(instId: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${instId} from OKX`);

      // Calculate time range: 480 hours ago
      const hoursAgo = 480;
      const before = Date.now(); // Latest time
      const after = before - (hoursAgo * 60 * 60 * 1000); // Earliest time

      // TODO: Replace with actual OKX endpoint
      // Example: GET /api/v5/public/funding-rate-history
      const response = await this.client.get<OKXFundingRateResponse>('/api/v5/public/funding-rate-history', {
        params: {
          instId,
          before, // Latest timestamp
          after,  // Earliest timestamp
          limit: 100, // TODO: Verify max limit (OKX typically uses 100)
        },
      });

      const fundingData = response.data.data;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${instId}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: instId,
        timestamp: new Date(parseInt(point.fundingTime)),
        fundingRate: point.fundingRate,
        premium: '0', // TODO: Check if OKX provides premium separately
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${instId}`);
      return results;
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
   * TODO: Add actual OKX rate limits
   * - Default delay: 600ms (placeholder, adjust based on actual limits)
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

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMsg = this.getErrorMessage(error);
        console.log(`[API] ✗ ${instId}: FAILED - ${errorMsg}`);
        logger.error(`Failed to fetch funding history for ${instId}`, errorMsg);
        results.set(instId, []);
        processed++;
        if (onProgress) {
          onProgress(instId, processed);
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default OKXClient;
