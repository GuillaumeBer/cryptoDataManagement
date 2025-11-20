# Open Interest API Comparison

## Platforms with SNAPSHOT-ONLY OI Data

### ✅ Hyperliquid (Already Working Correctly)
- **Endpoint**: POST `/info` with `type: 'metaAndAssetCtxs'`
- **Implementation**: [hyperliquid/client.ts:275-362](../src/api/hyperliquid/client.ts#L275-L362)
- **Method**: `getOpenInterestSnapshot()` - correctly named as snapshot
- **Returns**: Single snapshot for ALL assets at once (efficient!)
- **Database Status**: ✅ 666 records (from Nov 19, 2025)
- **Note**: Fetches all assets in one API call, then filters to requested symbols

**Example Response**:
```typescript
[
  { universe: [{ name: 'BTC', ... }, ...], ... },
  [
    { openInterest: '30974', ... },  // BTC
    { openInterest: '498690', ... }, // ETH
    ...
  ]
]
```

### ✅ Aster (Fixed Today)
- **OLD Endpoint**: GET `/futures/data/openInterestHist` ❌ (404 - doesn't exist)
- **NEW Endpoint**: GET `/fapi/v1/openInterest` ✅ (current snapshot)
- **Implementation**: [aster/client.ts:342-381](../src/api/aster/client.ts#L342-L381)
- **Method**: `getOpenInterest()` - fetches one symbol at a time
- **Returns**: Single snapshot per symbol
- **Database Status**: ✅ 3 test records (from Nov 20, 2025)
- **Note**: Requires one API call per symbol (slower than Hyperliquid)

**Example Response**:
```json
{
  "symbol": "BTCUSDT",
  "openInterest": "5458.092",
  "time": 1763619371908
}
```

## Platforms with HISTORICAL OI Data

### ✅ Binance
- **Endpoint**: GET `/futures/data/openInterestHist`
- **Returns**: Historical array of OI data points
- **Max Records**: 500 per request
- **Periods**: 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d

### ✅ Bybit
- **Endpoint**: GET `/v5/market/open-interest`
- **Returns**: Historical array of OI data points
- **Max Records**: 200 per request
- **Intervals**: 5min, 15min, 30min, 1h, 4h, 1d

### ✅ OKX
- **Endpoint**: GET `/api/v5/rubik/stat/contracts/open-interest-history`
- **Returns**: Historical array of OI data points
- **Max Records**: 100 per request
- **Periods**: 5m, 15m, 30m, 1H, 2H, 4H

## Key Differences

### Snapshot-Only Platforms (Hyperliquid, Aster)
**Pros**:
- Simple, real-time data
- Always current

**Cons**:
- No instant historical charts
- Must build history over time through periodic fetches
- Initial fetch shows only 1 data point per asset

**Solution**:
- Set up hourly/daily scheduled fetches
- Historical charts populate gradually

### Historical Platforms (Binance, Bybit, OKX)
**Pros**:
- Instant historical charts (up to 480+ hours)
- Rich data from first fetch

**Cons**:
- More complex API
- Requires time range calculations

## Recommendation

For **snapshot-only platforms** (Hyperliquid, Aster):
1. Run initial fetch to get current OI values
2. Set up **hourly incremental fetches** to build historical data
3. After 7 days: You'll have 7-day OI charts
4. After 30 days: You'll have 30-day OI charts

For **historical platforms** (Binance, Bybit, OKX):
1. Initial fetch populates 480 hours (20 days) of data immediately
2. Incremental fetches add new data points
