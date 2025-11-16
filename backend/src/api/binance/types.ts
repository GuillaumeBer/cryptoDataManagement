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
