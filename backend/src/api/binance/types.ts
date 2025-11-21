// Binance Futures API types

export interface BinanceAsset {
  symbol: string;
  pair: string;
  contractType: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

export interface BinanceExchangeInfo {
  symbols: BinanceAsset[];
}

export interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number; // Unix timestamp in milliseconds
  markPrice?: string;
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

export interface BinanceKline {
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

export interface BinanceOpenInterest {
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

export interface BinanceLongShortRatio {
  symbol: string;
  longShortRatio: string;
  longAccount: string; // "0.6543"
  shortAccount: string; // "0.3457"
  timestamp: number;
}

export interface FetchedLongShortRatioData {
  asset: string;
  timestamp: Date;
  longRatio: number;
  shortRatio: number;
  longAccount?: number;
  shortAccount?: number;
  platform: string;
  type: string;
  period: string;
}

export interface BinanceLiquidation {
  symbol: string;
  side: 'LONG' | 'SHORT';
  order: 'LIMIT' | 'MARKET';
  timeInForce: string;
  origQty: string;
  price: string;
  avgPrice: string;
  executedQty: string;
  status: string;
  time: number; // Unix timestamp in milliseconds
}

export interface FetchedLiquidationData {
  asset: string;
  timestamp: Date;
  side: 'Long' | 'Short';
  price: number;
  quantity: number;
  volumeUsd: number;
  platform: string;
}
