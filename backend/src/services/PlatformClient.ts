import { RateLimiter } from '../utils/rateLimiter';
import { PlatformAssetPayload } from './normalizers/platformAssetNormalizer';
import {
  FundingHistoryRecord,
  OHLCVRecord,
  OIRecord,
  LSRatioRecord,
  PlatformLiquidationRecord,
} from './fetchTypes';

/**
 * Union type for all platform API clients
 * Defines the interface that all platform-specific clients must implement
 */
export type PlatformClient = {
  getAssets(): Promise<PlatformAssetPayload[]>;
  
  getFundingHistoryBatch(
    symbols: string[],
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: FundingHistoryRecord[]) => Promise<void>
  ): Promise<Map<string, FundingHistoryRecord[]>>;
  
  getOHLCVBatch(
    symbols: string[],
    interval?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: OHLCVRecord[]) => Promise<void>
  ): Promise<Map<string, OHLCVRecord[]>>;
  
  getOpenInterestBatch(
    symbols: string[],
    period?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: OIRecord[]) => Promise<void>
  ): Promise<Map<string, OIRecord[]>>;
  
  getLongShortRatioBatch?(
    symbols: string[],
    period?: string | number,
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: LSRatioRecord[]) => Promise<void>
  ): Promise<Map<string, LSRatioRecord[]>>;
  
  getLiquidationsBatch?(
    symbols: string[],
    options?: {
      delayMs?: number;
      concurrency?: number;
      lookbackDays?: number;
      state?: string;
    },
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: PlatformLiquidationRecord[]) => Promise<void>
  ): Promise<Map<string, PlatformLiquidationRecord[]>>;
};
