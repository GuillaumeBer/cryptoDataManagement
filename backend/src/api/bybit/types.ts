// Bybit API types

export interface BybitSymbol {
  symbol: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  contractType?: string;
}

export interface BybitExchangeInfo {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitSymbol[];
  };
}

export interface BybitFundingRate {
  symbol: string;
  fundingRate: string;
  fundingRateTimestamp: string; // Unix timestamp in milliseconds
}

export interface BybitFundingRateResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitFundingRate[];
  };
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
