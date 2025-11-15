// Jupiter API types
// NOTE: Jupiter is primarily a Solana DEX aggregator for spot trading
// Perpetuals support may be added in the future via Jupiter Perps

export interface JupiterMarket {
  id: string;
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
}

export interface JupiterMarketsResponse {
  markets: JupiterMarket[];
}

export interface JupiterFundingRate {
  market: string;
  fundingRate: string;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
