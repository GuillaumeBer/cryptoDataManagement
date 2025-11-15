// OKX API types

export interface OKXInstrument {
  instId: string; // Instrument ID, e.g., "BTC-USDT-SWAP"
  instType: string; // Instrument type: SWAP, FUTURES, etc.
  state: string; // live, suspend, etc.
  ctVal: string; // Contract value
  ctMult: string; // Contract multiplier
}

export interface OKXInstrumentsResponse {
  code: string;
  msg: string;
  data: OKXInstrument[];
}

export interface OKXFundingRate {
  instId: string;
  fundingRate: string;
  fundingTime: string; // Unix timestamp in milliseconds
  realizedRate: string;
}

export interface OKXFundingRateResponse {
  code: string;
  msg: string;
  data: OKXFundingRate[];
}

export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string;
  premium: string;
}
