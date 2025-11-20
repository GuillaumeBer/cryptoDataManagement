# Open Interest Handling for Snapshot-Only Platforms

## Overview

Hyperliquid and Aster only provide **current OI snapshots**, not historical data. This document explains how OI is now handled for these platforms.

## Changes Made ✅

### 1. Backend: Auto-Fetch Disabled

**File**: [backend/src/services/dataFetcher.ts](backend/src/services/dataFetcher.ts#L89)

- Added `SNAPSHOT_ONLY_OI_PLATFORMS` constant identifying Hyperliquid and Aster
- Modified `fetchInitialData()` to skip OI fetch/store for these platforms
- Modified `fetchIncrementalData()` to skip OI fetch/store for these platforms

**Result**: Regular data fetches (initial/incremental) will **NOT** fetch OI for Hyperliquid and Aster.

```typescript
const SNAPSHOT_ONLY_OI_PLATFORMS = ['hyperliquid', 'aster'] as const;

// In fetch methods:
if (shouldSkipOI) {
  logger.info(`Skipping Open Interest auto-fetch for ${this.platform} (snapshot-only platform)`);
  // Skip OI stages
}
```

### 2. Frontend: OI Chart Hidden

**File**: [frontend/src/components/Dashboard.tsx](frontend/src/components/Dashboard.tsx#L229-234)

- Conditionally hide `<OpenInterestChart>` for Hyperliquid and Aster
- Other charts (Funding Rate, OHLCV) remain visible

```tsx
{/* Hide OI chart for snapshot-only platforms (Hyperliquid, Aster) */}
{selectedPlatform !== 'hyperliquid' && selectedPlatform !== 'aster' && (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <OpenInterestChart asset={selectedAsset} platform={selectedPlatform} />
  </div>
)}
```

### 3. CLI Command: Manual OI Snapshot Fetch

**File**: [backend/src/scripts/fetch-oi-snapshot.ts](backend/src/scripts/fetch-oi-snapshot.ts)

**NPM Script**: `npm run fetch-oi-snapshot <platform> [--assets ASSET1,ASSET2,...]`

Created a CLI tool to manually fetch OI snapshots on-demand.

## Usage Examples

### Fetch All Assets from Hyperliquid
```bash
cd backend
npm run fetch-oi-snapshot hyperliquid
```

**Output**:
```
=== Fetching OI Snapshot for HYPERLIQUID ===
Found 221 hyperliquid assets in database
Fetching OI snapshots for 221 assets from Hyperliquid...
✓ Fetched OI data for 221 assets
✓ BTC: 30,974 contracts
✓ ETH: 498,690 contracts
...
=== Summary ===
✓ Success: 221 assets
📊 Total OI snapshots stored: 221
```

### Fetch Specific Assets from Aster
```bash
cd backend
npm run fetch-oi-snapshot aster -- --assets BTC,ETH,SOL
```

**Output**:
```
=== Fetching OI Snapshot for ASTER ===
Found 160 aster assets in database
Filtering to 3 requested assets: BTC, ETH, SOL
Fetching OI snapshots for 3 assets from Aster...
(This may take a while due to rate limiting: ~700ms per asset)
✓ BTCUSDT: 5,440 contracts
✓ ETHUSDT: 102,758 contracts
✓ SOLUSDT: 1,005,461 contracts
=== Summary ===
✓ Success: 3 assets
📊 Total OI snapshots stored: 3
```

### Get Help
```bash
npm run fetch-oi-snapshot
```

## Recommended Workflow

### Building Historical OI Data

Since these platforms only provide snapshots, historical charts build up over time:

1. **Initial Snapshot** (now):
   ```bash
   npm run fetch-oi-snapshot hyperliquid
   npm run fetch-oi-snapshot aster
   ```
   → Charts show 1 data point per asset

2. **Schedule Periodic Fetches** (hourly or daily):
   ```bash
   # Cron job example (every hour)
   0 * * * * cd /path/to/backend && npm run fetch-oi-snapshot hyperliquid
   0 * * * * cd /path/to/backend && npm run fetch-oi-snapshot aster
   ```

3. **After 7 Days**: 168 data points → 7-day OI charts available
4. **After 30 Days**: 720 data points → 30-day OI charts available

### Manual Spot Checks

Fetch OI for specific high-value assets whenever needed:

```bash
# Check BTC, ETH, SOL every 4 hours
npm run fetch-oi-snapshot hyperliquid -- --assets BTC,ETH,SOL
npm run fetch-oi-snapshot aster -- --assets BTC,ETH,SOL
```

## Platform Comparison

| Platform | OI Data Type | Auto-Fetch | UI Chart | Manual Fetch |
|----------|--------------|------------|----------|--------------|
| **Hyperliquid** | Snapshot-only | ❌ Disabled | ❌ Hidden | ✅ CLI tool |
| **Aster** | Snapshot-only | ❌ Disabled | ❌ Hidden | ✅ CLI tool |
| Binance | Historical | ✅ Enabled | ✅ Visible | N/A |
| Bybit | Historical | ✅ Enabled | ✅ Visible | N/A |
| OKX | Historical | ✅ Enabled | ✅ Visible | N/A |
| DyDx | Historical | ✅ Enabled | ✅ Visible | N/A |
| GMX V2 | Historical | ✅ Enabled | ✅ Visible | N/A |
| Jupiter | Historical | ✅ Enabled | ✅ Visible | N/A |

## Implementation Details

### Why Skip Auto-Fetch?

1. **Snapshot Data Has No History**: Each fetch returns only current values, not historical arrays
2. **Efficiency**: No point in fetching the same single value repeatedly during data sync
3. **Cost/Rate Limits**: Aster requires 1 API call per asset (160 calls = 2+ minutes with rate limiting)
4. **User Control**: Manual fetches allow targeting specific assets or times

### API Differences

**Hyperliquid**:
- Endpoint: `POST /info` with `type: 'metaAndAssetCtxs'`
- Returns: All assets in one call (efficient!)
- Implementation: [hyperliquid/client.ts:275-316](backend/src/api/hyperliquid/client.ts#L275-L316)

**Aster**:
- Endpoint: `GET /fapi/v1/openInterest?symbol=BTCUSDT`
- Returns: One asset per call (requires rate limiting)
- Implementation: [aster/client.ts:342-381](backend/src/api/aster/client.ts#L342-L381)

## Database Schema

OI snapshots are stored in the same `open_interest_data` table:

```sql
CREATE TABLE open_interest_data (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  timestamp TIMESTAMP NOT NULL,
  timeframe VARCHAR(10) NOT NULL, -- Always '1h' for snapshots
  open_interest DECIMAL(30, 10) NOT NULL,
  open_interest_value DECIMAL(30, 10),
  platform VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_open_interest UNIQUE(asset_id, timestamp, platform, timeframe)
);
```

The `UNIQUE` constraint ensures:
- Multiple manual fetches of the same snapshot won't create duplicates
- Each hour gets one OI value per asset (perfect for hourly charts)

## Future Enhancements

Potential improvements:

1. **Scheduled Task**: Add cron job to auto-run CLI command hourly
2. **Notification**: Alert when OI changes significantly between snapshots
3. **Dashboard Widget**: Show "last snapshot" timestamp for these platforms
4. **Batch Mode**: Fetch multiple platforms in one command

## Questions?

- **Q: Can I still view historical OI for these platforms?**
  - A: Yes, but only data collected after you start running periodic snapshots

- **Q: How often should I fetch snapshots?**
  - A: Hourly for complete charts, daily for trends, or manually as needed

- **Q: What if I miss a snapshot?**
  - A: Charts will show gaps, but you can still see the trend over time

- **Q: Can I re-enable auto-fetch?**
  - A: Not recommended - it wastes API calls and doesn't provide historical data
