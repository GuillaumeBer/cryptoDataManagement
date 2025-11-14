// Aster API types

export interface AsterAsset {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  contractType: string;
}

export interface AsterFundingRate {
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
