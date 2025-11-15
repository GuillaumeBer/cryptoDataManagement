// Jupiter Perpetuals - Borrow Rate Types
// Documentation: See backend/src/api/jupiter/README.md
// Jupiter uses a "Perpetual Demand Lending Pool (PDLP)" model
// Traders pay "borrow fees" to the JLP pool, not funding rates to other traders

// Dune Analytics Query Result Structure
// Query 3338148: JLP Pool Borrow Rates
export interface DuneBorrowRateRecord {
  time: string; // ISO timestamp
  asset: string; // e.g., "SOL", "BTC", "ETH"
  utilization_rate: number; // 0.0 to 1.0
  borrow_rate: number; // hourly borrow rate (utilization_rate * 0.01)
  pool_balance_usd?: number;
  borrowed_usd?: number;
}

export interface DuneQueryExecutionResponse {
  execution_id: string;
  state: string; // "QUERY_STATE_PENDING", "QUERY_STATE_EXECUTING", "QUERY_STATE_COMPLETED"
}

export interface DuneQueryResultResponse {
  execution_id: string;
  query_id: number;
  state: string;
  submitted_at: string;
  expires_at: string;
  execution_started_at?: string;
  execution_ended_at?: string;
  result?: {
    rows: DuneBorrowRateRecord[];
    metadata: {
      column_names: string[];
      column_types: string[];
      row_count: number;
      result_set_bytes: number;
      total_row_count: number;
      datapoint_count: number;
      pending_time_millis: number;
      execution_time_millis: number;
    };
  };
}

// Jupiter Market (simplified - assets available in JLP pool)
export interface JupiterMarket {
  asset: string; // e.g., "SOL", "BTC", "ETH", "USDC"
  symbol: string; // Formatted symbol for display
}

export interface JupiterMarketsResponse {
  markets: JupiterMarket[];
}

// Standard format for our database
export interface FetchedFundingData {
  asset: string;
  timestamp: Date;
  fundingRate: string; // Actually "borrow rate" for Jupiter
  premium: string;
}
