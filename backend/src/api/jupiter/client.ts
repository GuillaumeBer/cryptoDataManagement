import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  JupiterMarket,
  DuneQueryExecutionResponse,
  DuneQueryResultResponse,
  DuneBorrowRateRecord,
  FetchedFundingData,
} from './types';

export class JupiterClient {
  private duneClient: AxiosInstance;
  private duneApiKey: string | undefined;
  private readonly DUNE_QUERY_ID = 3338148; // Community-validated borrow rate query
  private readonly MAX_POLL_ATTEMPTS = 60; // Max 60 attempts (120 seconds with 2s delay)
  private readonly POLL_DELAY_MS = 2000; // 2 seconds between polls

  constructor() {
    // Jupiter Perpetuals uses Dune Analytics for historical borrow rate data
    // Documentation: See backend/src/api/jupiter/README.md
    this.duneApiKey = process.env.DUNE_API_KEY;

    this.duneClient = axios.create({
      baseURL: 'https://api.dune.com/api/v1',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.duneApiKey && { 'X-Dune-API-Key': this.duneApiKey }),
      },
    });

    if (!this.duneApiKey) {
      logger.warn(
        'DUNE_API_KEY not set. Jupiter borrow rate data will not be available. ' +
          'Get your API key from https://dune.com/settings/api'
      );
    } else {
      logger.info('Jupiter Dune Analytics client initialized', {
        queryId: this.DUNE_QUERY_ID,
      });
    }
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
   * Fetch available assets from Jupiter Perpetuals
   *
   * Jupiter uses a single JLP liquidity pool with multiple assets
   * Common assets: SOL, ETH, BTC, USDC, USDT
   *
   * Note: This returns a static list of known assets since there's no
   * simple API to query available custody accounts
   */
  async getAssets(): Promise<JupiterMarket[]> {
    try {
      logger.info('Fetching Jupiter Perps assets');

      if (!this.duneApiKey) {
        throw new Error(
          'DUNE_API_KEY required for Jupiter integration. ' +
            'Set environment variable DUNE_API_KEY or see backend/src/api/jupiter/README.md'
        );
      }

      // Known Jupiter Perps assets in JLP pool
      // These are the major assets with custody accounts in the pool
      const knownAssets = [
        { asset: 'SOL', symbol: 'SOL-USD' },
        { asset: 'ETH', symbol: 'ETH-USD' },
        { asset: 'WBTC', symbol: 'BTC-USD' },
        { asset: 'USDC', symbol: 'USDC' },
        { asset: 'USDT', symbol: 'USDT' },
      ];

      logger.info(`Loaded ${knownAssets.length} Jupiter Perps assets`);
      return knownAssets;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch assets from Jupiter', errorMsg);
      throw new Error(`Failed to fetch assets: ${errorMsg}`);
    }
  }

  /**
   * Execute a Dune Analytics query and wait for results
   *
   * @param queryId - The Dune query ID to execute
   * @returns The query execution results
   */
  private async executeDuneQuery(queryId: number): Promise<DuneQueryResultResponse> {
    try {
      // Step 1: Start query execution
      logger.debug(`Executing Dune query ${queryId}`);
      const executeResponse = await this.duneClient.post<DuneQueryExecutionResponse>(
        `/query/${queryId}/execute`
      );

      const executionId = executeResponse.data.execution_id;
      logger.debug(`Dune execution started: ${executionId}`);

      // Step 2: Poll for completion
      let attempts = 0;
      while (attempts < this.MAX_POLL_ATTEMPTS) {
        await this.sleep(this.POLL_DELAY_MS);

        const statusResponse = await this.duneClient.get<DuneQueryResultResponse>(
          `/execution/${executionId}/results`
        );

        const state = statusResponse.data.state;
        logger.debug(`Dune query state: ${state} (attempt ${attempts + 1}/${this.MAX_POLL_ATTEMPTS})`);

        if (state === 'QUERY_STATE_COMPLETED') {
          logger.debug(`Dune query completed successfully`);
          return statusResponse.data;
        }

        if (state === 'QUERY_STATE_FAILED') {
          throw new Error('Dune query execution failed');
        }

        attempts++;
      }

      throw new Error(`Dune query timeout after ${this.MAX_POLL_ATTEMPTS} attempts`);
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to execute Dune query ${queryId}:`, errorMsg);
      throw error;
    }
  }

  /**
   * Fetch borrow rate history for a specific asset from Jupiter Perps
   *
   * Jupiter uses hourly "borrow fees" instead of traditional funding rates
   * These fees are paid to the JLP liquidity pool based on utilization
   *
   * Formula: borrow_rate = utilization_rate × 0.01%
   *
   * Data source: Dune Analytics Query 3338148
   * Historical depth: Limited by Dune query (typically 30-90 days)
   *
   * @param asset - Asset symbol (e.g., "SOL", "BTC", "ETH")
   * @returns Array of borrow rate data points
   */
  async getFundingHistory(asset: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching borrow rate history for ${asset} from Jupiter (via Dune)`);

      if (!this.duneApiKey) {
        throw new Error(
          'DUNE_API_KEY required. Get your API key from https://dune.com/settings/api'
        );
      }

      // Execute Dune query to get borrow rates
      const queryResult = await this.executeDuneQuery(this.DUNE_QUERY_ID);

      if (!queryResult.result || !queryResult.result.rows) {
        logger.warn(`No borrow rate data returned from Dune for ${asset}`);
        return [];
      }

      // Filter rows for this specific asset
      const assetRecords = queryResult.result.rows.filter(
        (row: DuneBorrowRateRecord) => row.asset === asset || row.asset === asset.toUpperCase()
      );

      // Convert to our standard format
      const results: FetchedFundingData[] = assetRecords.map((record: DuneBorrowRateRecord) => ({
        asset: asset,
        timestamp: new Date(record.time),
        fundingRate: (record.borrow_rate / 100).toString(), // Convert to decimal format
        premium: record.utilization_rate ? (record.utilization_rate * 100).toString() : '0',
      }));

      logger.debug(
        `Fetched ${results.length} borrow rate records for ${asset} from Jupiter (${assetRecords.length} total from Dune)`
      );

      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch borrow rate history for ${asset}:`, errorMsg);
      throw new Error(`Failed to fetch borrow rate history for ${asset}: ${errorMsg}`);
    }
  }

  /**
   * Fetch borrow rate history for multiple assets with rate limiting
   *
   * Note: Dune API has rate limits, so we add delays between assets
   * Rate limit: ~20 requests per minute for free tier
   *
   * @param assets - Array of asset symbols
   * @param delayMs - Delay between requests (default: 3000ms = 3 seconds)
   * @param onProgress - Optional progress callback
   */
  async getFundingHistoryBatch(
    assets: string[],
    delayMs: number = 3000,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    if (!this.duneApiKey) {
      logger.error('DUNE_API_KEY not set. Cannot fetch Jupiter borrow rates.');
      // Return empty results for all assets
      assets.forEach((asset) => results.set(asset, []));
      return results;
    }

    logger.info(`Fetching borrow rates for ${assets.length} assets from Jupiter (via Dune)`);

    // Dune query returns all assets at once, so we only need to execute it once
    try {
      const queryResult = await this.executeDuneQuery(this.DUNE_QUERY_ID);

      if (!queryResult.result || !queryResult.result.rows) {
        logger.warn('No borrow rate data returned from Dune');
        assets.forEach((asset) => results.set(asset, []));
        return results;
      }

      // Process each asset from the single query result
      let processed = 0;
      for (const asset of assets) {
        try {
          console.log(`[API] Processing ${asset} from Dune query results...`);

          // Filter rows for this asset
          const assetRecords = queryResult.result.rows.filter(
            (row: DuneBorrowRateRecord) =>
              row.asset === asset || row.asset === asset.toUpperCase()
          );

          // Convert to our standard format
          const data: FetchedFundingData[] = assetRecords.map((record: DuneBorrowRateRecord) => ({
            asset: asset,
            timestamp: new Date(record.time),
            fundingRate: (record.borrow_rate / 100).toString(),
            premium: record.utilization_rate ? (record.utilization_rate * 100).toString() : '0',
          }));

          results.set(asset, data);
          console.log(`[API] ✓ ${asset}: ${data.length} records`);

          processed++;
          if (onProgress) {
            onProgress(asset, processed);
          }
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          console.log(`[API] ✗ ${asset}: FAILED - ${errorMsg}`);
          logger.error(`Failed to process borrow rates for ${asset}`, errorMsg);
          results.set(asset, []);
          processed++;
          if (onProgress) {
            onProgress(asset, processed);
          }
        }
      }

      const totalRecords = Array.from(results.values()).reduce(
        (sum, data) => sum + data.length,
        0
      );
      logger.info(`Processed total of ${totalRecords} borrow rate records from Jupiter`);

      return results;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch Dune query for Jupiter borrow rates:', errorMsg);
      // Return empty results for all assets on error
      assets.forEach((asset) => results.set(asset, []));
      return results;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default JupiterClient;
