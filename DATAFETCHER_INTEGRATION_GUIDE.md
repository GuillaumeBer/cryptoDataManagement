# DataFetcher Integration Guide for Liquidations

## Current Status

✅ **Completed:**
- Database schema (migration 006)
- LiquidationRepository with CRUD operations  
- Type definitions in models/types.ts
- API clients for Binance (functional), OKX (functional), Bybit (placeholder)

⏳ **Remaining:**  
- DataFetcher service integration (this guide)
- API endpoints
- Frontend

## Challenge

The `dataFetcher.ts` file is 1,545 lines and highly complex. Direct editing causes file corruption due to the intricate type relationships and large number of interdependent sections.

## Recommended Approach: Manual Editing

**DO NOT** use automated tools for this integration. Instead, manually edit the file following these precise steps:

### Step 1: Add Type Definitions (Lines 1-112)

**Location 1:** After line 12, add import:
```typescript
import { liquidationRepository } from '../models/LiquidationRepository';
```

**Location 2:** After line 14, update imports:
```typescript
import { CreateFundingRateParams, CreateOHLCVParams, CreateOpenInterestParams, CreateLongShortRatioParams, CreateLiquidationParams } from '../models/types';
```

**Location 3:** After line 61 (after `LSRatioRecord` interface), add:
```typescript
interface LiquidationRecord {
  asset: string;
  timestamp: Date;
  side: 'Long' | 'Short';
  price: number;
  quantity: number;
  volumeUsd: number;
  platform: string;
}
```

**Location 4:** After line 111 (inside `PlatformClient` type, after `getLongShortRatioBatch`), add:
```typescript
  getLiquidationsBatch?(\n    symbols: string[],
    delayMs?: number,
    concurrency?: number,
    onProgress?: (currentSymbol: string, processed: number) => void,
    rateLimiter?: RateLimiter,
    onItemFetched?: (symbol: string, data: LiquidationRecord[]) => Promise<void>
  ): Promise<Map<string, LiquidationRecord[]>>;
```

### Step 2: Update FetchStage Type (Line ~115)

Find `export type FetchStage =` and add two stages:
```typescript
export type FetchStage =
  | 'assetDiscovery'
  | 'fundingFetch'
  | 'fundingStore'
  | 'ohlcvFetch'
  | 'ohlcvStore'
  | 'oiFetch'
  | 'oiStore'
  | 'lsRatioFetch'
  | 'lsRatioStore'
  | 'liquidationFetch'      // ADD THIS
  | 'liquidationStore'      // ADD THIS
  | 'resample';
```

### Step 3: Update ProgressEvent Interface (Line ~150)

Add to the `ProgressEvent` interface:
```typescript
  lsRatioRecordsFetched?: number;
  liquidationRecordsFetched?: number;  // ADD THIS
  resampleRecordsCreated?: number;
```

### Step 4: Update STAGE_LABELS (Line ~178)

Add to the `STAGE_LABELS` object:
```typescript
const STAGE_LABELS: Record<FetchStage, string> = {
  assetDiscovery: 'Discover assets',
  fundingFetch: 'Fetch funding rates',
  fundingStore: 'Store funding rates',
  ohlcvFetch: 'Fetch OHLCV data',
  ohlcvStore: 'Store OHLCV data',
  oiFetch: 'Fetch open interest',
  oiStore: 'Store open interest',
  lsRatioFetch: 'Fetch L/S Ratios',
  lsRatioStore: 'Store L/S Ratios',
  liquidationFetch: 'Fetch liquidations',    // ADD THIS
  liquidationStore: 'Store liquidations',    // ADD THIS
  resample: 'Generate 8h aggregates',
};
```

### Step 5: Update EmitStageProgressArgs (Line ~280)

Add to the interface:
```typescript
interface EmitStageProgressArgs {
  // ... existing fields ...
  lsRatioRecordsFetched?: number;
  liquidationRecordsFetched?: number;  // ADD THIS
  errors: string[];
  // ... rest of fields ...
}
```

### Step 6: Add Liquidation Fetch Method (Around line 1200-1400)

Add a new method `fetchAndStoreLiquidationsIncremental` following the pattern of `fetchAndStoreLongShortRatiosIncremental`:

```typescript
private async fetchAndStoreLiquidationsIncremental(
  platform: SupportedPlatform,
  client: PlatformClient,
  assets: { id: number; symbol: string }[],
  stageOrder: FetchStage[],
  stageMap: StageStateMap
): Promise<void> {
  if (!client.getLiquidationsBatch) {
    logger.info(`Platform ${platform} does not support liquidation data`);
    updateStage(stageMap, 'liquidationFetch', { status: 'complete', percentage: 100 });
    updateStage(stageMap, 'liquidationStore', { status: 'complete', percentage: 100 });
    return;
  }

  // Fetch stage
  updateStage(stageMap, 'liquidationFetch', { status: 'active', total: assets.length });

  const symbols = assets.map((a) => a.symbol);
  let recordsFetched = 0;

  try {
    await client.getLiquidationsBatch(
      symbols,
      600, // delayMs
      1,   // concurrency
      (symbol, processed) => {
        updateStage(stageMap, 'liquidationFetch', { completed: processed, currentItem: symbol });
        this.emitStageProgress({
          type: 'progress',
          phase: 'fetch',
          stageKey: 'liquidationFetch',
          stageOrder,
          stageMap,
          totalAssets: assets.length,
          processedAssets: processed,
          recordsFetched: 0,
          liquidationRecordsFetched: recordsFetched,
          errors: [],
        });
      },
      this.rateLimiter,
      async (symbol, data) => {
        // Store stage
        updateStage(stageMap, 'liquidationStore', { status: 'active', total: assets.length });

        const assetData = assets.find((a) => a.symbol === symbol);
        if (!assetData) {
          logger.warn(`Asset not found for symbol: ${symbol}`);
          return;
        }

        const records: CreateLiquidationParams[] = data.map((d) => ({
          asset_id: assetData.id,
          timestamp: d.timestamp,
          side: d.side,
          price: d.price,
          quantity: d.quantity,
          volume_usd: d.volumeUsd,
          platform,
        }));

        if (records.length > 0) {
          await liquidationRepository.bulkInsert(records);
          recordsFetched += records.length;
          logger.info(`Stored ${records.length} liquidation records for ${symbol}`);
        }

        updateStage(stageMap, 'liquidationStore', { 
          completed: stageMap.get('liquidationStore')!.completed + 1 
        });
      }
    );

    updateStage(stageMap, 'liquidationFetch', { status: 'complete', percentage: 100 });
    updateStage(stageMap, 'liquidationStore', { status: 'complete', percentage: 100 });

    logger.info(`Liquidation fetch complete. ${recordsFetched} records processed.`);
  } catch (error) {
    logger.error(`Error fetching/storing liquidations: ${error}`);
    throw error;
  }
}
```

### Step 7: Call the Method in fetchDataIncremental

Find the `fetchDataIncremental` method (around line 1150) and add the liquidation fetch call after long/short ratios:

```typescript
// ... After L/S Ratio fetch ...

// Fetch and store liquidations
await this.fetchAndStoreLiquidationsIncremental(
  this.platform,
  this.platformClient,
  assets,
  stageOrder,
  stageMap
);
```

### Step 8: Update Stage Orders

Add liquidation stages to the stage order arrays:

**INCREMENTAL_STAGE_ORDER** (around line 270):
```typescript
const INCREMENTAL_STAGE_ORDER: FetchStage[] = [
  'fundingFetch',
  'fundingStore',
  'ohlcvFetch',
  'ohlcvStore',
  'oiFetch',
  'oiStore',
  'lsRatioFetch',
  'lsRatioStore',
  'liquidationFetch',   // ADD THIS
  'liquidationStore',   // ADD THIS
];
```

## Testing

After making these changes:

1. **Compile check:** `cd backend && npm run build`
2. **Type check:** Look for TypeScript errors
3. **Start server:** Test that it starts without errors
4. **Test fetch:** Try fetching liquidation data for one platform

## Notes

- Bybit returns empty data (API limitation documented)
- Binance fetches ~7 days of history
- OKX uses dedicated liquidation endpoint
- Consider adding pagination for large datasets
- Database connection must be running before testing

## Alternative: Create Standalone Service

If the integration proves too risky, consider creating `services/LiquidationFetcherService.ts` as a separate, testable service that can be integrated later.
