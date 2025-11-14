import { DataFetcherService } from './dataFetcher';
import { logger } from '../utils/logger';

/**
 * Manages DataFetcherService instances for multiple platforms
 * Ensures a single instance per platform to prevent concurrent fetches
 */
class DataFetcherManager {
  private fetchers: Map<string, DataFetcherService> = new Map();

  /**
   * Get or create a DataFetcherService instance for a specific platform
   */
  getFetcher(platform: string): DataFetcherService {
    const normalizedPlatform = platform.toLowerCase();

    if (!this.fetchers.has(normalizedPlatform)) {
      logger.info(`Creating new DataFetcherService for platform: ${normalizedPlatform}`);
      this.fetchers.set(normalizedPlatform, new DataFetcherService(normalizedPlatform));
    }

    return this.fetchers.get(normalizedPlatform)!;
  }

  /**
   * Get all active platform names
   */
  getAllPlatforms(): string[] {
    return Array.from(this.fetchers.keys());
  }

  /**
   * Check if a platform has an active fetcher
   */
  hasFetcher(platform: string): boolean {
    return this.fetchers.has(platform.toLowerCase());
  }

  /**
   * Get status of all platform fetchers
   */
  getAllFetcherStatuses(): Record<string, boolean> {
    const statuses: Record<string, boolean> = {};

    for (const [platform, fetcher] of this.fetchers.entries()) {
      statuses[platform] = fetcher.isFetchInProgress();
    }

    return statuses;
  }
}

// Export singleton instance
export const dataFetcherManager = new DataFetcherManager();
export default dataFetcherManager;
