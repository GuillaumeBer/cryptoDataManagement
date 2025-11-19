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

// Response is an array of funding points for the requested coin
export type HyperliquidFundingHistoryResponse = HyperliquidFundingPoint[];

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

export interface HyperliquidCandle {
  t: number;  // Open time (ms)
  T: number;  // Close time (ms)
  s: string;  // Symbol
  i: string;  // Interval
  o: string;  // Open
  h: string;  // High
  l: string;  // Low
  c: string;  // Close
  v: string;  // Volume
  n: number;  // Number of trades
}

export interface HyperliquidCandleSnapshotRequest {
  coin: string;
  interval: string;
  startTime: number;
  endTime?: number;
}

export interface HyperliquidCandleSnapshotResponse {
  type: 'candleSnapshot';
  req: HyperliquidCandleSnapshotRequest;
  data: HyperliquidCandle[];
}

export interface FetchedOHLCVData {
  asset: string;
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradesCount: number;
}

export interface HyperliquidAssetContext {
  coin: string;
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
}

// Hyperliquid API returns an array: [meta, assetCtxs]
export type HyperliquidMetaAndAssetCtxsResponse = [
  {
    universe: Array<{
      name: string;
      szDecimals: number;
      maxLeverage: number;
      marginTableId?: number;
      onlyIsolated?: boolean;
      isDelisted?: boolean;
    }>;
    marginTables?: any;
    collateralToken?: any;
  },
  HyperliquidAssetContext[]
];

export interface FetchedOIData {
  asset: string;
  timestamp: Date;
  openInterest: string;
  openInterestValue?: string;
}
