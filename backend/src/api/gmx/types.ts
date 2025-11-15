// GMX API types
// GMX v2 (Arbitrum, Avalanche) perpetuals

export interface GMXMarket {
  marketToken: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  marketSymbol: string; // e.g., "BTC/USD", "ETH/USD"
}

export interface GMXMarketsResponse {
  markets: GMXMarket[];
}

export interface GMXFundingRate {
  market: string;
  longFundingRate: string;
  shortFundingRate: string;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface GMXFundingRateResponse {
  fundingRates: GMXFundingRate[];
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
