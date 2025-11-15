// DyDx V4 Indexer API types
// Documentation: https://docs.dydx.exchange/api_integration-indexer/indexer_api

export interface DyDxMarket {
  ticker: string; // e.g., "BTC-USD"
  status: string; // "ACTIVE", "PAUSED", etc.
  baseAsset: string; // e.g., "BTC"
  quoteAsset: string; // e.g., "USD"
  stepSize: string;
  tickSize: string;
  indexPrice: string;
  oraclePrice: string;
  priceChange24H: string;
  nextFundingRate: string;
  initialMarginFraction: string;
  maintenanceMarginFraction: string;
  transferMarginFraction: string;
  volume24H: string;
  trades24H: number;
  openInterest: string;
  atomicResolution: number;
  quantumConversionExponent: number;
  subticksPerTick: number;
  stepBaseQuantums: number;
  clobPairId: string;
}

export interface DyDxMarketsResponse {
  markets: {
    [ticker: string]: DyDxMarket;
  };
}

export interface DyDxHistoricalFundingItem {
  ticker: string; // e.g., "BTC-USD"
  rate: string; // Funding rate as decimal string
  price: string; // Oracle price at funding time
  effectiveAt: string; // ISO 8601 timestamp
  effectiveAtHeight: string; // Block height
}

export interface DyDxHistoricalFundingResponse {
  historicalFunding: DyDxHistoricalFundingItem[];
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
