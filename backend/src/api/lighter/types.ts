// Lighter API types

export interface LighterAsset {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface LighterFundingRate {
  symbol?: string;
  market_id?: string;
  fundingRate?: string;
  rate?: string; // Alternative field name
  fundingTime?: number; // Unix timestamp in milliseconds
  timestamp?: number; // Alternative field name
  markPrice?: string;
  premium?: string; // May be provided separately
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
