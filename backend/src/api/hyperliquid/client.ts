import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { runPromisePool } from '../../utils/promisePool';
import { RateLimiter } from '../../utils/rateLimiter';
import {
  HyperliquidMetaResponse,
  HyperliquidFundingHistoryResponse,
  HyperliquidAsset,
  FetchedFundingData,
  HyperliquidCandle,
  FetchedOHLCVData,
  HyperliquidMetaAndAssetCtxsResponse,
  FetchedOIData,
} from './types';

export class HyperliquidClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('Hyperliquid API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available assets from Hyperliquid
   */
  async getAssets(): Promise<HyperliquidAsset[]> {
    try {
      logger.info('Fetching assets from Hyperliquid');

      const response = await this.client.post<HyperliquidMetaResponse>('/info', {
        type: 'meta',
      });

      const assets = response.data.universe.map((asset) => ({
        name: asset.name,
        maxLeverage: asset.maxLeverage,
      }));

      logger.info(`Fetched ${assets.length} assets from Hyperliquid`);
      return assets;
    } catch (error) {
      logger.error('Failed to fetch assets from Hyperliquid', error);
      throw new Error(`Failed to fetch assets: ${error}`);
    }
  }

  /**
   * Fetch funding rate history for a specific asset
   * Returns last 480 hours of data (max supported by Hyperliquid is 500 hours)
   */
  async getFundingHistory(coin: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${coin}`);

      // Calculate startTime: 480 hours ago in milliseconds
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);

      const response = await this.client.post<HyperliquidFundingHistoryResponse>('/info', {
        type: 'fundingHistory',
        coin,
        startTime,
      });

      const fundingData = response.data;
      if (!fundingData || !Array.isArray(fundingData)) {
        logger.warn(`No funding data found for ${coin}`);
        return [];
      }

      const results: FetchedFundingData[] = fundingData.map((point) => ({
        asset: coin,
        timestamp: new Date(point.time),
        fundingRate: point.fundingRate,
        premium: point.premium,
      }));

      logger.debug(`Fetched ${results.length} funding rate records for ${coin}`);
      return results;
    } catch (error: any) {
      const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Failed to fetch funding history for ${coin}: ${errorDetails}`);
      throw new Error(`Failed to fetch funding history for ${coin}: ${errorDetails}`);
    }
  }

  /**
   * Fetch funding history for multiple assets with rate limiting
   */
  async getFundingHistoryBatch(
    coins: string[],
    delayMs: number = 100,
    concurrency: number = 1,
    onProgress?: (currentCoin: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedFundingData[]) => Promise<void>
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${coins.length} assets`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      coins,
      async (coin) => {
        try {
          logger.info(`[API] Fetching ${coin}...`);
          const data = await this.getFundingHistory(coin);

          // If we have an item callback, use it and don't store in memory
          if (onItemFetched) {
            await onItemFetched(coin, data);
          } else {
            results.set(coin, data);
          }

          logger.info(`[API] ✓ ${coin}: ${data.length} records`);
        } catch (error) {
          logger.error(`[API] ✗ ${coin}: FAILED`);
          logger.error(`Failed to fetch funding history for ${coin}`, error);
          if (!onItemFetched) {
            results.set(coin, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(coin, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 44 } // Approximate weight for Hyperliquid
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} funding rate records`);

    return results;
  }

  /**
   * Fetch OHLCV (candle) history for a specific symbol
   * Endpoint: POST /info with type "candleSnapshot"
   *
   * API Documentation:
   * - Max: 5000 candles
   * - Interval: "1h" for 1-hour candles
   *
   * Rate Limits:
   * - Public endpoints: Conservative approach
   */
  async getOHLCV(symbol: string, interval: string = '1h'): Promise<FetchedOHLCVData[]> {
    try {
      logger.debug(`Fetching OHLCV history for ${symbol} from Hyperliquid`);

      // Calculate time range: 480 hours ago to match funding rate depth
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const response = await this.client.post<HyperliquidCandle[]>('/info', {
        type: 'candleSnapshot',
        req: {
          coin: symbol,
          interval,
          startTime,
          endTime,
        },
      });

      const candles = response.data;
      if (!candles || !Array.isArray(candles)) {
        logger.warn(`No OHLCV data found for ${symbol}`);
        return [];
      }

      const results: FetchedOHLCVData[] = candles.map((candle) => ({
        asset: symbol,
        timestamp: new Date(candle.t),
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v,
        quoteVolume: '0', // Hyperliquid doesn't provide quote volume directly
        tradesCount: candle.n,
      }));

      logger.debug(`Fetched ${results.length} OHLCV records for ${symbol}`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch OHLCV for ${symbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch OHLCV for ${symbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch OHLCV history for multiple symbols with rate limiting
   *
   * Hyperliquid Rate Limits:
   * - Conservative delay: 2500ms to match funding rate fetching pattern
   */
  async getOHLCVBatch(
    symbols: string[],
    interval: string = '1h',
    delayMs: number = 2500,
    concurrency: number = 2,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOHLCVData[]) => Promise<void>
  ): Promise<Map<string, FetchedOHLCVData[]>> {
    const results = new Map<string, FetchedOHLCVData[]>();

    logger.info(`Fetching OHLCV data for ${symbols.length} assets from Hyperliquid`);

    let processed = 0;
    const safeConcurrency = Math.max(1, concurrency);

    await runPromisePool(
      symbols,
      async (symbol) => {
        try {
          logger.info(`[API] Fetching OHLCV ${symbol} from Hyperliquid...`);
          const data = await this.getOHLCV(symbol, interval);

          if (onItemFetched) {
            await onItemFetched(symbol, data);
          } else {
            results.set(symbol, data);
          }

          logger.info(`[API] ✓ ${symbol}: ${data.length} OHLCV records`);
        } catch (error) {
          const errorMsg = this.getErrorMessage(error);
          logger.error(`[API] ✗ ${symbol}: FAILED - ${errorMsg}`);
          logger.error(`Failed to fetch OHLCV for ${symbol}`, errorMsg);
          if (!onItemFetched) {
            results.set(symbol, []);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress(symbol, processed);
          }
        }
      },
      { concurrency: safeConcurrency, delayMs, rateLimiter, weight: 20 } // Approximate weight
    );

    const totalRecords = Array.from(results.values()).reduce(
      (sum, data) => sum + data.length,
      0
    );
    logger.info(`Fetched total of ${totalRecords} OHLCV records from Hyperliquid`);

    return results;
  }

  /**
   * Fetch current open interest snapshot for all assets
   * Endpoint: POST /info with type "metaAndAssetCtxs"
   *
   * Note: Hyperliquid does NOT provide historical OI data via API
   * This method returns a current snapshot only
   *
   * To build historical OI data, this method should be called periodically
   * and results stored with timestamps
   */
  async getOpenInterestSnapshot(): Promise<Map<string, FetchedOIData>> {
    try {
      logger.debug('Fetching open interest snapshot from Hyperliquid');

      const response = await this.client.post<HyperliquidMetaAndAssetCtxsResponse>('/info', {
        type: 'metaAndAssetCtxs',
      });

      // Response is [{universe: [...], ...}, assetCtxs]
      const meta = response.data[0];
      const assetCtxs = response.data[1];
      const universe = meta?.universe;

      if (!assetCtxs || !Array.isArray(assetCtxs) || !universe || !Array.isArray(universe)) {
        logger.warn('No asset contexts found in Hyperliquid response');
        return new Map();
      }

      const results = new Map<string, FetchedOIData>();
      const currentTime = new Date();

      // Universe and assetCtxs are parallel arrays
      for (let i = 0; i < Math.min(universe.length, assetCtxs.length); i++) {
        const symbol = universe[i].name;
        const ctx = assetCtxs[i];

        results.set(symbol, {
          asset: symbol,
          timestamp: currentTime,
          openInterest: ctx.openInterest,
          openInterestValue: undefined, // Hyperliquid doesn't provide OI value
        });
      }

      logger.debug(`Fetched open interest snapshot for ${results.size} assets from Hyperliquid`);
      return results;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch open interest snapshot: ${errorMsg}`);
      throw new Error(`Failed to fetch open interest snapshot: ${errorMsg}`);
    }
  }

  /**
   * Fetch open interest for specific coins (returns current snapshot)
   *
   * Note: Hyperliquid only provides current snapshots, no historical data
   * This is a compatibility method that calls getOpenInterestSnapshot
   * and filters results to requested symbols
   *
   * @param coins - Array of coin symbols
   * @param period - Ignored (Hyperliquid only provides snapshots)
   * @param delayMs - Delay between requests (not used for snapshots)
   * @param concurrency - Concurrency limit (not used for snapshots)
   * @param onProgress - Progress callback
   */
  async getOpenInterestBatch(
    coins: string[],
    _period?: string | number,
    _delayMs?: number,
    _concurrency?: number,
    onProgress?: (currentCoin: string, processed: number) => void,
    _rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FetchedOIData[]) => Promise<void>
  ): Promise<Map<string, FetchedOIData[]>> {
    const results = new Map<string, FetchedOIData[]>();

    logger.info(`Fetching open interest snapshot for ${coins.length} assets from Hyperliquid`);

    // Get snapshot for all assets at once (Hyperliquid limitation)
    const snapshot = await this.getOpenInterestSnapshot();

    // Filter to requested coins and convert to array format
    for (const coin of coins) {
      const oiData = snapshot.get(coin);
      let data: FetchedOIData[] = [];
      if (oiData) {
        data = [oiData];
      }

      if (onItemFetched) {
        await onItemFetched(coin, data);
      } else {
        results.set(coin, data);
      }

      if (onProgress) {
        onProgress(coin, results.size);
      }
    }

    logger.info(`Fetched open interest snapshot for ${results.size} assets from Hyperliquid`);

    return results;
  }
}

export default HyperliquidClient;
