// Lighter API types

export interface LighterAsset {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface LighterFundingRate {
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
