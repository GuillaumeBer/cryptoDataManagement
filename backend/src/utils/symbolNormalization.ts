/**
 * Symbol Normalization Utility
 *
 * Handles mapping of asset symbols across different platforms to identify the same underlying asset.
 *
 * Examples:
 * - Hyperliquid: "BTC" → "BTC"
 * - Binance: "BTCUSDT" → "BTC"
 * - Bybit: "BTCUSDT" → "BTC"
 * - OKX: "BTC-USDT-SWAP" → "BTC"
 * - DyDx V4: "BTC-USD" → "BTC"
 * - Aster: "BTCUSDT" → "BTC"
 */

import { logger } from './logger';

// Common suffixes to strip
const SUFFIXES_TO_REMOVE = [
  'USDT',
  'USDC',
  'USD',
  'BUSD',
  'PERP',
  'PERPETUAL',
  '-PERP',
  '-PERPETUAL',
  '-USD',
  '-USDT',
  '-USDC',
  '/USDT',
  '/USD',
  '/USDC',
];

/**
 * Normalize a symbol to its base asset
 * @param symbol - The raw symbol from the platform (e.g., "BTCUSDT", "BTC-PERP")
 * @param platform - The platform name for platform-specific logic
 * @returns Normalized base symbol (e.g., "BTC")
 */
export function normalizeSymbol(symbol: string, platform?: string): string {
  if (!symbol) return '';

  let normalized = symbol.toUpperCase().trim();

  // Platform-specific normalization FIRST (before general suffix removal)
  // This allows platform-specific patterns to be cleaned, then general cleanup can proceed
  if (platform) {
    switch (platform.toLowerCase()) {
      case 'hyperliquid':
        // Hyperliquid already uses clean symbols (BTC, ETH, etc.)
        break;
      case 'binance':
      case 'bybit':
        // Binance/Bybit use formats like "BTCUSDT"
        // Will be handled by suffix removal below
        break;
      case 'okx':
        // OKX uses formats like "BTC-USDT-SWAP"
        // Remove -SWAP suffix first, then general suffix removal will clean up the rest
        normalized = normalized.replace(/-SWAP$/, '');
        break;
      case 'dydx':
        // DyDx V4 uses formats like "BTC-USD"
        // Will be handled by suffix removal below
        break;
      case 'aster':
        // Aster uses formats like "BTCUSDT"
        // Will be handled by suffix removal below
        break;
    }
  }

  // Remove common suffixes (try longest matches first)
  const sortedSuffixes = [...SUFFIXES_TO_REMOVE].sort((a, b) => b.length - a.length);

  for (const suffix of sortedSuffixes) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length);
      break; // Only remove one suffix to avoid over-stripping
    }
  }

  // Remove trailing dashes or slashes
  normalized = normalized.replace(/[-/]+$/, '');

  logger.debug(`Symbol normalized: ${symbol} → ${normalized}${platform ? ` (${platform})` : ''}`);
  return normalized;
}

/**
 * Get potential matching symbols across platforms
 * @param symbol - The symbol to match
 * @param sourcePlatform - The platform the symbol is from
 * @returns Object with normalized symbol and platform-specific variations
 */
export function getSymbolVariations(symbol: string, sourcePlatform?: string): {
  normalized: string;
  variations: Record<string, string[]>;
} {
  const normalized = normalizeSymbol(symbol, sourcePlatform);

  const variations: Record<string, string[]> = {
    hyperliquid: [normalized],
    binance: [
      `${normalized}USDT`,
      `${normalized}BUSD`,
      normalized,
    ],
    bybit: [
      `${normalized}USDT`,
      `${normalized}USDC`,
      normalized,
    ],
    okx: [
      `${normalized}-USDT-SWAP`,
      `${normalized}-USDC-SWAP`,
      `${normalized}-USD-SWAP`,
      normalized,
    ],
    dydx: [
      `${normalized}-USD`,
      `${normalized}-USDC`,
      normalized,
    ],
    aster: [
      normalized,
      `${normalized}USDT`,
      `${normalized}USD`,
      `${normalized}USDC`,
    ],
  };

  return { normalized, variations };
}

/**
 * Check if two symbols represent the same base asset
 * @param symbol1 - First symbol
 * @param platform1 - First platform
 * @param symbol2 - Second symbol
 * @param platform2 - Second platform
 * @returns True if symbols represent the same asset
 */
export function isSameAsset(
  symbol1: string,
  platform1: string,
  symbol2: string,
  platform2: string
): boolean {
  const normalized1 = normalizeSymbol(symbol1, platform1);
  const normalized2 = normalizeSymbol(symbol2, platform2);

  return normalized1 === normalized2;
}

/**
 * Group assets by normalized symbol
 * @param assets - Array of assets with symbol and platform properties
 * @returns Map of normalized symbols to arrays of assets
 */
export function groupAssetsByNormalizedSymbol<T extends { symbol: string; platform: string }>(
  assets: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const asset of assets) {
    const normalized = normalizeSymbol(asset.symbol, asset.platform);

    if (!grouped.has(normalized)) {
      grouped.set(normalized, []);
    }

    grouped.get(normalized)!.push(asset);
  }

  return grouped;
}
