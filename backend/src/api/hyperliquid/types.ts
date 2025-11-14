// Hyperliquid API types

export interface HyperliquidMetaResponse {
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated: boolean;
  }>;
}

export interface HyperliquidFundingPoint {
  time: number; // Unix timestamp in milliseconds
  coin: string;
  fundingRate: string; // Decimal string
  premium: string; // Decimal string
}

export interface HyperliquidFundingHistoryResponse {
  [assetName: string]: HyperliquidFundingPoint[];
}

export interface HyperliquidAsset {
  name: string;
  maxLeverage: number;
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
