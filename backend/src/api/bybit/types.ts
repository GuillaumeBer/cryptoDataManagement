// Bybit V5 API types
// Documentation: https://bybit-exchange.github.io/docs/v5/intro

export interface BybitInstrument {
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
    list: BybitInstrument[];
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
