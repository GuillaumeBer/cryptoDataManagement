// DyDx V4 API types

export interface DyDxMarket {
  ticker: string; // e.g., "BTC-USD"
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marketId: number;
}

export interface DyDxMarketsResponse {
  markets: {
    [ticker: string]: DyDxMarket;
  };
}

export interface DyDxFundingRate {
  ticker: string;
  rate: string;
  price: string;
  effectiveAt: string; // ISO timestamp
  effectiveAtHeight: string;
}

export interface DyDxHistoricalFundingResponse {
  historicalFunding: DyDxFundingRate[];
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
