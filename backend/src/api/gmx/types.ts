// GMX V2 Subgraph API types
// Documentation: https://docs.gmx.io/docs/api/subgraph
// Subgraph: GMX V2 Synthetics on Arbitrum

export interface GMXMarket {
  id: string; // Market address
  marketToken: string;
  indexToken: string;
  indexTokenSymbol: string; // e.g., "BTC", "ETH"
  longToken: string;
  shortToken: string;
}

export interface GMXMarketsResponse {
  data: {
    markets: GMXMarket[];
  };
}

export interface GMXCollectedMarketFeesInfo {
  id: string; // Format: marketAddress:timestampGroup
  marketAddress: string;
  period: string; // "1h" for hourly
  timestampGroup: number; // Unix timestamp
  cumulativeFundingFeeUsdPerPoolValue: string; // Cumulative funding fee
  fundingFeeAmountPerSize: string; // Funding rate for the period
}

export interface GMXFundingRateHistoryResponse {
  data: {
    collectedMarketFeesInfos: GMXCollectedMarketFeesInfo[];
  };
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

