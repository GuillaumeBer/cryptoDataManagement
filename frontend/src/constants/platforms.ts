export const PLATFORMS = [
  // DEX Platforms
  { id: 'hyperliquid', name: 'Hyperliquid', enabled: true },
  { id: 'dydx', name: 'DyDx V4', enabled: true },
  { id: 'aster', name: 'Aster Finance', enabled: true },
  // CEX Platforms
  { id: 'binance', name: 'Binance Futures', enabled: true },
  { id: 'bybit', name: 'Bybit', enabled: true },
  { id: 'okx', name: 'OKX', enabled: true },
] as const;

export type Platform = (typeof PLATFORMS)[number]['id'];
