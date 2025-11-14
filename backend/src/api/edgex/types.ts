// EdgeX API types

export interface EdgeXAsset {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  contractType: string;
}

export interface EdgeXFundingRate {
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
