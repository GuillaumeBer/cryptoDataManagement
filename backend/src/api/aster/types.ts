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

export interface AsterKline {
  0: number;  // Open time
  1: string;  // Open
  2: string;  // High
  3: string;  // Low
  4: string;  // Close
  5: string;  // Volume
  6: number;  // Close time
  7: string;  // Quote asset volume
  8: number;  // Number of trades
  9: string;  // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
  11: string; // Ignore
}

export interface FetchedOHLCVData {
  asset: string;
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradesCount: number;
}

export interface AsterOpenInterest {
  symbol: string;
  sumOpenInterest: string; // Total open interest in contracts
  sumOpenInterestValue: string; // Total open interest value in USD
  timestamp: number; // Unix timestamp in milliseconds
}

export interface FetchedOIData {
  asset: string;
  timestamp: Date;
  openInterest: string;
  openInterestValue?: string;
}

