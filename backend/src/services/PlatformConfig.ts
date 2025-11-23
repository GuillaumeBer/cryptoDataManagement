import { SupportedPlatform } from './normalizers/platformAssetNormalizer';

/**
 * Centralized platform-specific configuration
 * Extracts all platform settings from DataFetcherService
 */
export class PlatformConfig {
  constructor(private readonly platform: SupportedPlatform) {}

  /**
   * Get the sampling interval for funding rates
   * - Hyperliquid: 1h (hourly funding, pays 1/8th of 8h rate each hour)
   * - Binance: 8h (tri-daily funding at 00:00, 08:00, 16:00 UTC)
   * - Bybit: 8h (tri-daily funding at 00:00, 08:00, 16:00 UTC)
   */
  getSamplingInterval(): string {
    switch (this.platform) {
      case 'hyperliquid':
        return '1h';
      case 'binance':
      case 'bybit':
      case 'okx':
      case 'dydx':
        return '8h';
      case 'aster':
        return '1h';
      default:
        return '8h';
    }
  }

  /**
   * Get the OHLCV interval/timeframe for each platform
   */
  getOHLCVInterval(): string | number {
    switch (this.platform) {
      case 'hyperliquid':
        return '1h';
      case 'binance':
        return '1h';
      case 'bybit':
        return 60; // Bybit expects minutes as a number
      case 'okx':
        return '1H';
      case 'dydx':
        return '1HOUR';
      case 'aster':
        return '1h';
      default:
        return '1h';
    }
  }

  /**
   * Get the Open Interest interval/period for each platform
   */
  getOIInterval(): string | number {
    switch (this.platform) {
      case 'binance':
        return '1h';
      case 'bybit':
        return '1h';
      case 'okx':
        return '1H';
      case 'dydx':
        return '1HOUR'; // Dydx expects '1HOUR' for candles endpoint
      default:
        return '1h';
    }
  }

  /**
   * Get the Long/Short Ratio interval/period for each platform
   */
  getLSRatioInterval(): string {
    switch (this.platform) {
      case 'binance':
        return '5m'; // High granularity
      case 'bybit':
        return '5min'; // Bybit supports 5min, 15min, 30min, 1h, 4h, 1d
      case 'okx':
        return '1H'; // OKX supports 5m, 1H, 4H, 1D
      default:
        return '1h';
    }
  }

  /**
   * Get the concurrency limit for parallel fetching
   * Can be overridden via environment variables
   */
  getConcurrencyLimit(): number {
    const envKey = `${this.platform.toUpperCase()}_FETCH_CONCURRENCY`;
    const envValue = process.env[envKey] || process.env.FETCH_CONCURRENCY;

    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    // With centralized RateLimiter, we can increase concurrency
    switch (this.platform) {
      case 'hyperliquid':
        return 5;
      case 'binance':
        return 1;
      case 'bybit':
        return 10;
      case 'okx':
        return 2;
      case 'dydx':
        return 1;
      case 'aster':
        return 2;
      default:
        return 1;
    }
  }

  /**
   * Get the Long/Short Ratio specific concurrency
   * Some platforms need lower concurrency for L/S ratios
   */
  getLSRatioConcurrency(): number {
    if (this.platform === 'okx') {
      return 1;
    }
    return this.getConcurrencyLimit();
  }

  /**
   * Get the Long/Short Ratio specific delay (ms)
   * Some platforms need additional throttling
   */
  getLSRatioDelay(): number {
    switch (this.platform) {
      case 'okx':
        return 600; // ~100 requests per minute
      default:
        return 0;
    }
  }

  /**
   * Get Rate Limiter configuration for the platform
   */
  getRateLimiterConfig(): { capacity: number; interval: number } {
    switch (this.platform) {
      case 'hyperliquid':
        // 1200 weight per minute
        return { capacity: 1200, interval: 60000 };
      case 'binance':
        // 2400 weight per minute (conservative default)
        return { capacity: 2400, interval: 60000 };
      case 'bybit':
        // 120 requests per second = 7200 per minute
        return { capacity: 7200, interval: 60000 };
      case 'okx':
        // 20 requests per 2 seconds = 600 per minute
        return { capacity: 600, interval: 60000 };
      case 'dydx':
        // Conservative: 100 requests per minute (~1.6/sec) to avoid 429s
        return { capacity: 100, interval: 60000 };
      case 'aster':
        // Very conservative due to strict rate limiting
        return { capacity: 600, interval: 60000 };
      default:
        return { capacity: 600, interval: 60000 };
    }
  }

  /**
   * Check if this platform only supports OI snapshots (not historical)
   */
  isSnapshotOnlyOI(): boolean {
    return ['hyperliquid', 'aster'].includes(this.platform);
  }
}
