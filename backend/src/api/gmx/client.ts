import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import {
  GMXMarket,
  GMXMarketsResponse,
  GMXFundingRateHistoryResponse,
  FetchedFundingData,
} from './types';

export class GMXClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    // GMX V2 Synthetics Subgraph on Arbitrum
    // Documentation: https://docs.gmx.io/docs/api/subgraph
    this.baseURL =
      process.env.GMX_SUBGRAPH_URL ||
      'https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/synthetics-arbitrum-stats/api';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: parseInt(process.env.API_TIMEOUT || '30000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('GMX V2 Subgraph API client initialized', { baseURL: this.baseURL });
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
   * Fetch all available perpetual markets from GMX V2 on Arbitrum
   *
   * Uses GraphQL subgraph query to get market data
   * Markets are identified by their index token symbol (BTC, ETH, etc.)
   */
  async getAssets(): Promise<GMXMarket[]> {
    try {
      logger.info('Fetching perpetual markets from GMX V2 Subgraph');

      const query = `
        query GetMarkets {
          markets(first: 1000, where: { marketToken_not: null }) {
            id
            marketToken
            indexToken
            longToken
            shortToken
          }
        }
      `;

      const response = await this.client.post<any>('', {
        query,
      });

      // Debug logging to see the response structure
      logger.debug('GMX GraphQL response:', {
        status: response.status,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
        sample: JSON.stringify(response.data).substring(0, 500)
      });

      // Check for GraphQL errors
      if (response.data.errors) {
        logger.error('GMX GraphQL errors:', response.data.errors);
        throw new Error(`GMX subgraph error: ${JSON.stringify(response.data.errors)}`);
      }

      // Check if response has the expected structure
      if (!response.data || !response.data.data) {
        logger.error('Unexpected GMX response structure:', response.data);
        throw new Error(`Invalid response from GMX subgraph. Expected data.data, got: ${Object.keys(response.data || {}).join(', ')}`);
      }

      if (!response.data.data.markets) {
        logger.error('No markets in GMX response:', response.data.data);
        throw new Error('No markets found in GMX subgraph response');
      }

      const markets = response.data.data.markets;

      // Add symbol information - extract from token addresses using common mappings
      const marketsWithSymbols = markets.map((market) => {
        // Extract symbol from market ID or use a mapping
        // Common GMX markets: BTC, ETH, LINK, ARB, etc.
        const symbol = this.extractSymbolFromMarket(market);
        return {
          ...market,
          indexTokenSymbol: symbol,
        };
      });

      logger.info(`Fetched ${marketsWithSymbols.length} active perpetual markets from GMX V2`);
      return marketsWithSymbols;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      logger.error('Failed to fetch markets from GMX V2', errorMsg);
      throw new Error(`Failed to fetch markets: ${errorMsg}`);
    }
  }

  /**
   * Extract trading pair symbol from market data
   * GMX markets are identified by index token addresses
   */
  private extractSymbolFromMarket(market: GMXMarket): string {
    // Common GMX V2 index token addresses on Arbitrum (lowercase, without 0x prefix)
    const tokenMapping: { [key: string]: string } = {
      '47904963fc8b2340414262125af65b9118c000': 'BTC',
      '82af49447d8a07e3bd95bd0d56f35241523fbab1': 'ETH',
      'f97f4df75117a78c1a5a0dbb814af92458539fb4': 'LINK',
      '912ce59144191c1204e64559fe8253a0e49e6548': 'ARB',
      'fa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 'UNI',
      'fc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a': 'GMX',
      'ff970a61a04b1ca14834a43f5de4533ebddb5cc8': 'USDC',
      'fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
      '2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 'WBTC',
    };

    const indexToken = market.indexToken.toLowerCase().replace('0x', '');

    // Check if we have a known mapping
    for (const [address, symbol] of Object.entries(tokenMapping)) {
      if (indexToken === address) {
        return `${symbol}-USD`;
      }
    }

    // Fallback: use market ID
    return `GMX-MARKET-${market.id.substring(0, 8)}`;
  }

  /**
   * Fetch funding rate history for a specific market
   *
   * GMX V2 uses hourly funding intervals
   * Historical depth: 480 hours (480 funding periods at 1h intervals)
   *
   * Rate Limits: The Graph has generous rate limits for public queries
   */
  async getFundingHistory(marketSymbol: string): Promise<FetchedFundingData[]> {
    try {
      logger.debug(`Fetching funding history for ${marketSymbol} from GMX V2`);

      // Calculate time range (last 480 hours)
      const hoursAgo = 480;
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - hoursAgo * 60 * 60;

      // Query funding fee data from subgraph
      // Note: GMX uses "borrowing fees" which are equivalent to funding rates
      const query = `
        query GetFundingHistory($timestampGte: Int!) {
          collectedMarketFeesInfos(
            first: 1000
            orderBy: timestampGroup
            orderDirection: desc
            where: {
              period: "1h"
              timestampGroup_gte: $timestampGte
            }
          ) {
            id
            marketAddress
            period
            timestampGroup
            fundingFeeAmountPerSize
            cumulativeFundingFeeUsdPerPoolValue
          }
        }
      `;

      const response = await this.client.post<GMXFundingRateHistoryResponse>('', {
        query,
        variables: {
          timestampGte: startTime,
        },
      });

      const feeInfos = response.data.data.collectedMarketFeesInfos;

      // Convert to our standard format
      const fundingData: FetchedFundingData[] = feeInfos.map((info) => ({
        asset: marketSymbol,
        timestamp: new Date(info.timestampGroup * 1000),
        fundingRate: info.fundingFeeAmountPerSize || '0',
        premium: info.cumulativeFundingFeeUsdPerPoolValue || '0',
      }));

      logger.debug(
        `Fetched ${fundingData.length} funding rate records for ${marketSymbol} from GMX V2`
      );
      return fundingData;
    } catch (error: any) {
      const errorMsg = this.getErrorMessage(error);
      logger.error(`Failed to fetch funding history for ${marketSymbol}: ${errorMsg}`);
      throw new Error(`Failed to fetch funding history for ${marketSymbol}: ${errorMsg}`);
    }
  }

  /**
   * Fetch funding history for multiple markets with rate limiting
   *
   * Default delay: 200ms between requests to respect subgraph rate limits
   */
  async getFundingHistoryBatch(
    markets: string[],
    delayMs: number = 200,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();

    logger.info(`Fetching funding history for ${markets.length} markets from GMX V2`);

    let processed = 0;
    for (const market of markets) {
      try {
        console.log(`[API] Fetching ${market} from GMX V2...`);
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
    logger.info(`Fetched total of ${totalRecords} funding rate records from GMX V2`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default GMXClient;
