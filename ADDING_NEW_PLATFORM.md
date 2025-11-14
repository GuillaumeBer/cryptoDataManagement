# Adding a New PERPS Platform

This guide shows how to add support for a new perpetual futures platform (e.g., Binance Futures).

## Architecture Overview

Each platform needs:
1. **API Client** - Fetches data from the platform's API
2. **DataFetcherService Support** - Integration with the existing fetcher
3. **Frontend Updates** - Enable the platform tab

---

## Step 1: Create Platform API Client

### Example: Binance Futures

Create `backend/src/api/binance/types.ts`:

```typescript
export interface BinanceAsset {
  symbol: string;
  pair: string;
  contractType: string;
  deliveryDate: number;
  onboardDate: number;
  status: string;
}

export interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice: string;
}

export interface FetchedFundingData {
  timestamp: Date;
  fundingRate: number;
  premium: number | null;
}
```

Create `backend/src/api/binance/client.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { BinanceAsset, BinanceFundingRate, FetchedFundingData } from './types';

export default class BinanceClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://fapi.binance.com',
      timeout: 30000,
    });
  }

  /**
   * Get all perpetual futures symbols
   */
  async getAssets(): Promise<BinanceAsset[]> {
    const response = await this.client.get('/fapi/v1/exchangeInfo');

    // Filter for PERPETUAL contracts only
    return response.data.symbols.filter(
      (s: any) => s.contractType === 'PERPETUAL' && s.status === 'TRADING'
    );
  }

  /**
   * Get funding rate history for a symbol
   * Binance API: GET /fapi/v1/fundingRate
   */
  async getFundingHistory(symbol: string): Promise<FetchedFundingData[]> {
    // Binance allows max 1000 records per request
    const limit = 1000;

    // Calculate startTime for last 20 days (Binance limit)
    const startTime = Date.now() - (20 * 24 * 60 * 60 * 1000);

    const response = await this.client.get<BinanceFundingRate[]>('/fapi/v1/fundingRate', {
      params: {
        symbol,
        startTime,
        limit,
      },
    });

    return response.data.map((fr) => ({
      timestamp: new Date(fr.fundingTime),
      fundingRate: parseFloat(fr.fundingRate),
      premium: null, // Binance doesn't provide premium separately
    }));
  }

  /**
   * Fetch funding history for multiple symbols with rate limiting
   */
  async getFundingHistoryBatch(
    symbols: string[],
    delayMs: number = 100,
    onProgress?: (currentSymbol: string, processed: number) => void
  ): Promise<Map<string, FetchedFundingData[]>> {
    const results = new Map<string, FetchedFundingData[]>();
    let processed = 0;

    for (const symbol of symbols) {
      try {
        console.log(`[API] Fetching ${symbol}...`);
        const data = await this.getFundingHistory(symbol);
        console.log(`[API] ✓ ${symbol}: ${data.length} records`);

        results.set(symbol, data);
        processed++;

        if (onProgress) {
          onProgress(symbol, processed);
        }

        // Rate limiting: Binance allows 2400 weight/minute
        await this.sleep(delayMs);
      } catch (error) {
        logger.error(`Failed to fetch funding history for ${symbol}`, error);
        results.set(symbol, []);
      }
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

## Step 2: Update DataFetcherService for Multi-Platform

### Option A: Multiple Instances (Recommended)

Create `backend/src/services/dataFetcherManager.ts`:

```typescript
import { DataFetcherService } from './dataFetcher';

class DataFetcherManager {
  private fetchers: Map<string, DataFetcherService> = new Map();

  getFetcher(platform: string): DataFetcherService {
    if (!this.fetchers.has(platform)) {
      this.fetchers.set(platform, new DataFetcherService(platform));
    }
    return this.fetchers.get(platform)!;
  }

  getAllPlatforms(): string[] {
    return Array.from(this.fetchers.keys());
  }
}

export default new DataFetcherManager();
```

### Update DataFetcherService Constructor

Modify `backend/src/services/dataFetcher.ts`:

```typescript
import HyperliquidClient from '../api/hyperliquid/client';
import BinanceClient from '../api/binance/client';

export class DataFetcherService extends EventEmitter {
  private platformClient: HyperliquidClient | BinanceClient;
  private platform: string;
  // ... rest of properties

  constructor(platform: string = 'hyperliquid') {
    super();
    this.platform = platform;

    // Initialize the correct client based on platform
    switch (platform) {
      case 'hyperliquid':
        this.platformClient = new HyperliquidClient();
        break;
      case 'binance':
        this.platformClient = new BinanceClient();
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  // Update fetchInitialData to use this.platformClient instead of this.hyperliquidClient
  async fetchInitialData() {
    // ...
    const assets = await this.platformClient.getAssets();
    // ...
    const fundingDataMap = await this.platformClient.getFundingHistoryBatch(...);
    // ...
  }
}
```

---

## Step 3: Update API Routes

Modify `backend/src/routes/api.ts` to accept platform parameter:

```typescript
// Add platform parameter to SSE endpoints
router.get('/fetch/stream', async (req: Request, res: Response) => {
  const platform = (req.query.platform as string) || 'hyperliquid';

  // ... SSE setup ...

  // Get the platform-specific fetcher
  const fetcher = DataFetcherManager.getFetcher(platform);

  // ... rest of SSE logic ...
});

router.get('/fetch/incremental/stream', async (req: Request, res: Response) => {
  const platform = (req.query.platform as string) || 'hyperliquid';
  const fetcher = DataFetcherManager.getFetcher(platform);
  // ... rest of SSE logic ...
});
```

---

## Step 4: Update Frontend DataFetcher

Modify `frontend/src/components/DataFetcher.tsx` to pass platform parameter:

```typescript
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const eventSource = new EventSource(`${apiUrl}/fetch/stream?platform=${platform}`);
```

---

## Step 5: Enable Platform in Frontend

Update `frontend/src/components/Dashboard.tsx`:

```typescript
const PLATFORMS: { id: Platform; name: string; enabled: boolean }[] = [
  { id: 'hyperliquid', name: 'Hyperliquid', enabled: true },
  { id: 'binance', name: 'Binance Futures', enabled: true }, // ← Set to true
  { id: 'dydx', name: 'dYdX', enabled: false },
];
```

---

## Platform-Specific Considerations

### Binance Futures
- **API Docs**: https://binance-docs.github.io/apidocs/futures/en/
- **Rate Limit**: 2400 weight/minute
- **Max History**: 1000 records (~20 days at 8h intervals)
- **Symbols**: Use BTCUSDT, ETHUSDT format
- **No Authentication**: Public endpoints only

### dYdX v4
- **API Docs**: https://docs.dydx.exchange/
- **Rate Limit**: More lenient
- **Historical Data**: Longer history available
- **Symbols**: Use format like BTC-USD

### Symbol Normalization

You may need to normalize symbols between platforms:
- Hyperliquid: BTC, ETH
- Binance: BTCUSDT, ETHUSDT
- dYdX: BTC-USD, ETH-USD

Consider adding a symbol mapper utility.

---

## Testing Checklist

- [ ] API client can fetch assets
- [ ] API client can fetch funding history
- [ ] Rate limiting works correctly
- [ ] Data is stored in database with correct platform
- [ ] Frontend tab switches correctly
- [ ] Progress bar works for the new platform
- [ ] Charts display data correctly
- [ ] Staleness badges work

---

## Next Steps

1. Start with Binance Futures (easiest to integrate)
2. Test thoroughly with a small number of assets first
3. Add symbol normalization if needed
4. Consider adding platform-specific configuration (rate limits, delays, etc.)
5. Document any platform-specific quirks

---

## Need Help?

The current implementation for Hyperliquid is a great reference:
- `backend/src/api/hyperliquid/client.ts`
- `backend/src/services/dataFetcher.ts`
- `backend/src/routes/api.ts`
