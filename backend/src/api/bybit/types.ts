// Bybit V5 API types
// Documentation: https://bybit-exchange.github.io/docs/v5/intro

export interface BybitAsset {
  symbol: string; // e.g., "BTCUSDT"
  contractType: string; // "LinearPerpetual"
  status: string; // "Trading", "Closed", etc.
  baseCoin: string; // e.g., "BTC"
  quoteCoin: string; // e.g., "USDT"
  launchTime: string; // Unix timestamp in milliseconds
  deliveryTime: string;
  deliveryFeeRate: string;
  priceScale: string;
  leverageFilter: {
    minLeverage: string;
    maxLeverage: string;
    leverageStep: string;
  };
  priceFilter: {
    minPrice: string;
    maxPrice: string;
    tickSize: string;
  };
  lotSizeFilter: {
    maxOrderQty: string;
    minOrderQty: string;
    qtyStep: string;
    postOnlyMaxOrderQty: string;
  };
  unifiedMarginTrade: boolean;
  fundingInterval: number; // Funding interval in minutes (480 = 8 hours)
}

export interface BybitInstrumentsResponse {
  retCode: number; // 0 for success
  retMsg: string; // "OK" for success
  result: {
    category: string; // "linear"
    list: BybitAsset[];
    nextPageCursor: string;
  };
  retExtInfo: {};
  time: number; // Response timestamp
}

export interface BybitFundingRateHistoryItem {
  symbol: string; // e.g., "BTCUSDT"
  fundingRate: string; // e.g., "0.0001" (0.01%)
  fundingRateTimestamp: string; // Unix timestamp in milliseconds
}

export interface BybitFundingRateHistoryResponse {
  retCode: number; // 0 for success
  retMsg: string; // "OK" for success
  result: {
    category: string; // "linear"
    list: BybitFundingRateHistoryItem[];
  };
  retExtInfo: {};
  time: number; // Response timestamp
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

export interface BybitKlineItem {
  0: string; // Start time
  1: string; // Open
  2: string; // High
  3: string; // Low
  4: string; // Close
  5: string; // Volume
  6: string; // Turnover (quote volume)
}

export interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    symbol: string;
    list: BybitKlineItem[];
  };
  retExtInfo: {};
  time: number;
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

export interface BybitOpenInterestItem {
  openInterest: string; // Total open interest
  timestamp: string; // Unix timestamp in milliseconds
}

export interface BybitOpenInterestResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    symbol: string;
    list: BybitOpenInterestItem[];
    nextPageCursor: string;
  };
  retExtInfo: {};
  time: number;
}

export interface FetchedOIData {
  asset: string;
  timestamp: Date;
  openInterest: string;
  openInterestValue?: string;
}

export interface BybitAccountRatioResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: Array<{
      symbol: string;
      buyRatio: string; // "0.6543"
      sellRatio: string; // "0.3457"
      timestamp: string; // "1672531200000"
    }>;
  };
}

export interface FetchedLongShortRatioData {
  asset: string;
  timestamp: Date;
  longRatio: number;
  shortRatio: number;
  longAccount?: number;
  shortAccount?: number;
  platform: string;
  type: string;
  period: string;
}
