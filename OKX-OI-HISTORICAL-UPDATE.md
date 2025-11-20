# OKX Open Interest Historical Data Update

## Problem
Previously, OKX Open Interest (OI) fetching was only returning **1 data point** per asset (current snapshot), not historical data.

## Root Cause
The implementation was using the wrong API endpoint:
- **Old endpoint**: `/api/v5/public/open-interest` - Returns only current snapshot
- **New endpoint**: `/api/v5/rubik/stat/contracts/open-interest-history` - Returns historical data

## Solution Implemented

### 1. Updated OKX Client ([client.ts](backend/src/api/okx/client.ts))
- ✅ Changed endpoint to `/api/v5/rubik/stat/contracts/open-interest-history`
- ✅ Now fetches **30 days** of historical Open Interest data
- ✅ Uses `period=1D` with `limit=30` for efficient fetching (1 API call per symbol)
- ✅ Returns 30 daily data points per asset

### 2. Updated Type Definitions ([types.ts](backend/src/api/okx/types.ts))
- ✅ Added `OKXOpenInterestHistoryData` type for the array response format
- ✅ Added `OKXOpenInterestHistoryResponse` interface

### 3. Updated Data Fetcher ([dataFetcher.ts](backend/src/services/dataFetcher.ts))
- ✅ Added `getOITimeframe()` method to return correct timeframe per platform
- ✅ OKX now stores OI data with `timeframe='1d'` (daily data)
- ✅ Other platforms continue to store `timeframe='1h'` (hourly data)

## API Response Format

The historical endpoint returns data as an array of arrays:
```json
{
  "code": "0",
  "data": [
    [
      "1763568000000",     // Timestamp (ms)
      "2785288.04",        // Open Interest (contracts)
      "27852.88",          // Open Interest (base currency)
      "2573884677.76"      // Open Interest value (USD)
    ],
    // ... more records
  ]
}
```

## Data Retrieved

When fetching through the UI:
- **30 daily data points** per asset
- **Covers approximately 30 days** of history
- **Fields included**:
  - `timestamp`: Date/time of the snapshot
  - `open_interest`: Number of contracts
  - `open_interest_value`: USD value of open interest

## Testing Results

✅ Successfully tested with BTC, ETH, and SOL:
```
BTC-USDT-SWAP: 30 records (29 days)
ETH-USDT-SWAP: 30 records (29 days)
SOL-USDT-SWAP: 30 records (29 days)
```

## Database Storage

- **Timeframe**: `1d` (daily) for OKX
- **Platform**: `okx`
- **Records**: Each OI snapshot is stored with timestamp, asset_id, open_interest, and open_interest_value

## Usage Through UI

When you trigger a data fetch for OKX through the UI:
1. Initial fetch or incremental fetch will now retrieve 30 days of OI data
2. Each asset will have ~30 daily data points
3. Data is stored in the `open_interest` table with `timeframe='1d'`
4. You can view and analyze the historical trends in the UI

## Notes

- The `period` parameter passed to `getOpenInterest()` is ignored; it always uses `1D` internally for consistency
- Pagination (`before` parameter) doesn't work reliably on this endpoint, so we use daily aggregation
- This approach is more efficient (1 API call) vs. trying to fetch 720 hourly records (8 API calls)
