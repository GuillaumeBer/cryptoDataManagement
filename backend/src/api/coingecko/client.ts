import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';

export interface CoinGeckoCoin {
  id: string; // e.g., 'bitcoin'
  symbol: string; // e.g., 'btc'
  name: string; // e.g., 'Bitcoin'
}

export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number;
}

export interface CoinGeckoPriceHistory {
  prices: Array<[number, number]>; // [timestamp_ms, price]
  market_caps: Array<[number, number]>;
  total_volumes: Array<[number, number]>;
}

export class CoinGeckoClient {
  private client: AxiosInstance;
  private readonly baseURL = 'https://api.coingecko.com/api/v3';
  private readonly requestDelay = 1200; // 1.2 seconds between requests (free tier: 50 calls/min)
  private lastRequestTime = 0;
  private coinsListCache: CoinGeckoCoin[] | null = null;
  private coinsListCacheTimestamp = 0;
  private readonly coinsListCacheTTL = 1000 * 60 * 60; // 1 hour cache window
  private marketDataCache = new Map<
    string,
    { data: CoinGeckoMarketData[]; timestamp: number }
  >();
  private readonly marketDataCacheTTL = 1000 * 60 * 5; // 5 minutes

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Rate limiting: wait before making request if needed
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.requestDelay) {
      const waitTime = this.requestDelay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Get list of all supported coins
   * @returns Array of all coins with id, symbol, and name
   */
  async getCoinsList(forceRefresh = false): Promise<CoinGeckoCoin[]> {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.coinsListCache &&
      now - this.coinsListCacheTimestamp < this.coinsListCacheTTL
    ) {
      logger.debug('Using cached CoinGecko coins list');
      return this.coinsListCache;
    }

    await this.rateLimit();

    try {
      const response = await this.client.get('/coins/list');
      logger.info(`Fetched ${response.data.length} coins from CoinGecko`);
      this.coinsListCache = response.data;
      this.coinsListCacheTimestamp = Date.now();
      return this.coinsListCache;
    } catch (error) {
      logger.error('Error fetching CoinGecko coins list:', error);
      throw error;
    }
  }

  /**
   * Get market data for top coins by market cap
   * @param limit - Number of coins to fetch (max 250 per page)
   * @param page - Page number (1-indexed)
   * @param vsCurrency - Currency to get prices in (default: 'usd')
   */
  async getMarketData(
    limit: number = 250,
    page: number = 1,
    vsCurrency: string = 'usd'
  ): Promise<CoinGeckoMarketData[]> {
    const cacheKey = `${limit}:${page}:${vsCurrency}`;
    const cached = this.marketDataCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.marketDataCacheTTL) {
      logger.debug(
        `Using cached CoinGecko market data for key ${cacheKey}`
      );
      return cached.data;
    }

    await this.rateLimit();

    try {
      const response = await this.client.get('/coins/markets', {
        params: {
          vs_currency: vsCurrency,
          order: 'market_cap_desc',
          per_page: Math.min(limit, 250),
          page,
          sparkline: false,
        },
      });

      logger.info(`Fetched ${response.data.length} coins market data from CoinGecko (page ${page})`);
      this.marketDataCache.set(cacheKey, {
        data: response.data,
        timestamp: Date.now(),
      });
      return response.data;
    } catch (error) {
      logger.error(`Error fetching CoinGecko market data (page ${page}):`, error);
      throw error;
    }
  }

  /**
   * Get historical price data for a coin
   * @param coinId - CoinGecko coin ID (e.g., 'bitcoin')
   * @param days - Number of days of history (1, 7, 14, 30, 90, 180, 365, 'max')
   * @param vsCurrency - Currency to get prices in (default: 'usd')
   * @returns Price history with timestamps and prices
   */
  async getPriceHistory(
    coinId: string,
    days: number | 'max' = 14,
    vsCurrency: string = 'usd'
  ): Promise<CoinGeckoPriceHistory> {
    await this.rateLimit();

    try {
      const response = await this.client.get(`/coins/${coinId}/market_chart`, {
        params: {
          vs_currency: vsCurrency,
          days,
          interval: days === 1 ? 'hourly' : 'daily',
        },
      });

      logger.info(`Fetched ${response.data.prices.length} price points for ${coinId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching price history for ${coinId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific coin
   * @param coinId - CoinGecko coin ID
   */
  async getCoinDetails(coinId: string): Promise<any> {
    await this.rateLimit();

    try {
      const response = await this.client.get(`/coins/${coinId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
      });

      logger.info(`Fetched details for ${coinId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching details for ${coinId}:`, error);
      throw error;
    }
  }

  /**
   * Search for a coin by name or symbol
   * @param query - Search query
   */
  async searchCoins(query: string): Promise<any> {
    await this.rateLimit();

    try {
      const response = await this.client.get('/search', {
        params: { query },
      });

      return response.data.coins || [];
    } catch (error) {
      logger.error(`Error searching for "${query}":`, error);
      throw error;
    }
  }

  /**
   * Find best matching CoinGecko coin for a given symbol
   * Prioritizes exact symbol matches and top market cap coins
   */
  async findCoinBySymbol(symbol: string): Promise<CoinGeckoCoin | null> {
    const normalizedSymbol = symbol.toLowerCase().trim();

    // First, try to get all coins and find exact match
    const allCoins = await this.getCoinsList();
    const exactMatches = allCoins.filter(
      (coin) => coin.symbol.toLowerCase() === normalizedSymbol
    );

    if (exactMatches.length === 0) {
      logger.warn(`No CoinGecko match found for symbol: ${symbol}`);
      return null;
    }

    if (exactMatches.length === 1) {
      logger.info(`Found exact match for ${symbol}: ${exactMatches[0].id}`);
      return exactMatches[0];
    }

    // Multiple matches - get market data to find the one with highest market cap
    logger.info(`Found ${exactMatches.length} matches for ${symbol}, fetching market data`);

    try {
      const marketData = await this.getMarketData(250, 1);
      const marketDataMap = new Map(marketData.map((coin) => [coin.id, coin]));

      // Sort by market cap (higher is better)
      exactMatches.sort((a, b) => {
        const marketA = marketDataMap.get(a.id);
        const marketB = marketDataMap.get(b.id);

        if (!marketA && !marketB) return 0;
        if (!marketA) return 1;
        if (!marketB) return -1;

        return marketB.market_cap - marketA.market_cap;
      });

      const bestMatch = exactMatches[0];
      logger.info(
        `Selected ${bestMatch.id} as best match for ${symbol} (highest market cap)`
      );
      return bestMatch;
    } catch (error) {
      logger.warn(
        `Error fetching market data for disambiguation, returning first match: ${exactMatches[0].id}`
      );
      return exactMatches[0];
    }
  }

  /**
   * Batch fetch price histories for multiple coins
   * Returns map of coinId -> price history
   */
  async batchGetPriceHistories(
    coinIds: string[],
    days: number = 14
  ): Promise<Map<string, CoinGeckoPriceHistory>> {
    const results = new Map<string, CoinGeckoPriceHistory>();

    logger.info(`Fetching price histories for ${coinIds.length} coins (${days} days)`);

    for (const coinId of coinIds) {
      try {
        const history = await this.getPriceHistory(coinId, days);
        results.set(coinId, history);
      } catch (error) {
        logger.error(`Failed to fetch price history for ${coinId}:`, error);
        // Continue with other coins
      }
    }

    logger.info(`Successfully fetched ${results.size}/${coinIds.length} price histories`);
    return results;
  }
}

export default new CoinGeckoClient();
