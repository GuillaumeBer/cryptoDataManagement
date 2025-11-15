// Aster Finance Futures V3 API types
// Documentation: github.com/asterdex/api-docs (aster-finance-futures-api-v3.md)
// Note: Aster API is nearly identical to Binance USDM Futures API

export interface AsterAsset {
  symbol: string;
  status: string; // "TRADING", etc.
  baseAsset: string;
  quoteAsset: string;
  contractType: string; // "PERPETUAL"
  marginAsset?: string;
}

export interface AsterExchangeInfo {
  symbols: AsterAsset[];
}

export interface AsterFundingRate {
  symbol: string;
  fundingRate: string; // The funding rate
  fundingTime: number; // Unix timestamp in milliseconds
  markPrice?: string; // Mark price at funding time
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

