// OKX V5 API types
// Documentation: https://www.okx.com/docs-v5/en/

export interface OKXAsset {
  instType: string; // "SWAP"
  instId: string; // e.g., "BTC-USDT-SWAP"
  uly: string; // Underlying, e.g., "BTC-USDT"
  category: string; // "1" for linear contracts
  baseCcy: string; // Base currency, e.g., "BTC"
  quoteCcy: string; // Quote currency, e.g., "USDT"
  settleCcy: string; // Settlement currency, e.g., "USDT"
  ctVal: string; // Contract value
  ctMult: string; // Contract multiplier
  ctValCcy: string; // Contract value currency
  listTime: string; // Listing time, Unix timestamp in milliseconds
  expTime: string; // Expiry time, Unix timestamp in milliseconds (for futures)
  lever: string; // Max leverage
  tickSz: string; // Tick size
  lotSz: string; // Lot size
  minSz: string; // Minimum order size
  ctType: string; // Contract type: linear, inverse
  alias: string; // Alias for futures
  state: string; // Status: live, suspend, preopen, test
}

export interface OKXInstrumentsResponse {
  code: string; // "0" for success
  msg: string; // "" for success, error message otherwise
  data: OKXAsset[];
}

export interface OKXFundingRate {
  instType: string; // "SWAP"
  instId: string; // e.g., "BTC-USDT-SWAP"
  fundingRate: string; // e.g., "0.0001" (historical rate)
  nextFundingRate: string; // Next funding rate (predicted)
  fundingTime: string; // Funding time, Unix timestamp in milliseconds
  nextFundingTime: string; // Next funding time
  realizedRate: string; // Realized funding rate
}

export interface OKXFundingRateHistoryResponse {
  code: string; // "0" for success
  msg: string; // "" for success, error message otherwise
  data: OKXFundingRate[];
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}

export interface OKXKline {
  0: string; // Timestamp (ms)
  1: string; // Open
  2: string; // High
  3: string; // Low
  4: string; // Close
  5: string; // Volume (contracts)
  6: string; // Volume (currency)
  7: string; // Volume (quote currency)
  8: string; // Confirm (0: not confirmed, 1: confirmed)
}

export interface OKXKlineResponse {
  code: string; // "0" for success
  msg: string;
  data: OKXKline[];
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

export interface OKXOpenInterest {
  instId: string; // e.g., "BTC-USDT-SWAP"
  instType: string; // "SWAP"
  oi: string; // Open interest (number of contracts)
  oiCcy: string; // Open interest value in currency
  ts: string; // Unix timestamp in milliseconds
}

export interface OKXOpenInterestResponse {
  code: string; // "0" for success
  msg: string;
  data: OKXOpenInterest[];
}

export interface FetchedOIData {
  asset: string;
  timestamp: Date;
  openInterest: string;
  openInterestValue?: string;
}
