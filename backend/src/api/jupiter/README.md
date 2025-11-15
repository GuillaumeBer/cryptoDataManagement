# Jupiter Perpetuals - Borrow Rate Data Integration

## Status: Special Configuration Required ⚠️

Jupiter Perpetuals operates on a **fundamentally different architecture** than traditional centralized exchanges. It does NOT have traditional "funding rates" - instead it uses **borrow fees** paid to the JLP liquidity pool.

## Critical Understanding

### Jupiter's "Perpetual Demand Lending Pool (PDLP)" Model

Unlike CEX platforms where funding rates are payments between long and short traders, Jupiter uses:
- **Borrow Fees**: Traders pay fees to the JLP pool (not to other traders)
- **Hourly Calculation**: Fees calculated dynamically based on pool utilization
- **Formula**: `borrow_rate = utilization_rate × 0.01%`

Where:
- `utilization_rate = borrowed_tokens / pool_tokens`
- Calculated and applied every hour

## Data Retrieval Methods

### Method 1: Historical Data via Dune Analytics (RECOMMENDED)

**Best for**: Backtesting, historical analysis, research

The most practical approach for historical borrow rate data:

#### Setup
1. Create a Dune Analytics account
2. Get API key from https://dune.com/settings/api
3. Set environment variable: `DUNE_API_KEY=your_key_here`

#### Implementation (Python)
```python
from dune_client.client import DuneClient
from dune_client.query import QueryBase
import pandas as pd

# Initialize Dune client
dune = DuneClient(api_key="YOUR_DUNE_API_KEY")

# Query ID 3338148 calculates borrow rates from on-chain data
query = QueryBase(
    name="Jupiter Perps Borrow Rate",
    query_id=3338148  # Community-validated query
)

# Fetch historical borrow rates
results_df = dune.run_query_dataframe(query=query)
print(results_df)
```

#### Key Dune Analytics Queries

| Query ID | Purpose | URL |
|----------|---------|-----|
| 3338148 | **JLP Pool Borrow Rates** (Critical) | https://dune.com/queries/3338148/5593343 |
| 3417634 | On-chain Fee Details | https://dune.com/queries/3417634 |
| 3343473 | Trading Volume | https://dune.com/queries/3343473/5602450 |

#### TypeScript Implementation
```typescript
import { DuneClient } from "@duneanalytics/client";

const dune = new DuneClient(process.env.DUNE_API_KEY);

const results = await dune.execute({
  queryId: 3338148,
});

console.log(results.result?.rows);
```

### Method 2: Real-Time Data via Solana RPC

**Best for**: Live trading bots, real-time monitoring

Requires direct Solana blockchain queries:

#### Requirements
- Solana RPC endpoint (Helius, QuickNode, or local node)
- Jupiter PERPS Program ID: `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- Anchor IDL for data deserialization

#### Implementation
```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program } from '@project-serum/anchor';

const connection = new Connection('https://your-rpc-endpoint.com');
const programId = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');

// Load IDL and create program instance
// Reference: github.com/julianfssen/jupiter-perps-anchor-idl-parsing

// Fetch Pool Account to get custody accounts
// Fetch Custody Account for specific asset (e.g., SOL)
// Calculate: utilization_rate = borrowed / deposited
// Calculate: borrow_rate = utilization_rate * 0.01
```

#### Reference Repositories
- IDL Parsing: `julianfssen/jupiter-perps-anchor-idl-parsing`
- TypeScript Client: `jup-perps-client`
- C# Client: `Solnet.JupiterPerps`

## Common Pitfalls to Avoid

### ❌ DO NOT Confuse Borrow Rates with JLP Token Price

Many data providers show "Jupiter Perps LP" historical data - this is the **JLP token price**, NOT borrow rates:
- JLP price = AUM of liquidity pool
- Borrow rate = cost of leverage for traders

**Using JLP price instead of borrow rates will invalidate any trading strategy.**

### ❌ Third-Party APIs Don't Support Jupiter PERPS

These services **DO NOT** provide Jupiter borrow rate data:
- CoinAPI (supports CEX only, not Solana DEX)
- Helius (parses swaps only, not perps)
- BitMEX, Binance, etc. (wrong protocol entirely)

## Integration Complexity

| Aspect | Complexity | Reason |
|--------|-----------|---------|
| Historical Data | **Medium** | Requires Dune Analytics API subscription |
| Real-Time Data | **Very High** | Requires Solana blockchain expertise, Anchor IDL parsing |
| Data Interpretation | **High** | Different model than traditional funding rates |

## Current Implementation Status

✅ **Fully Implemented** via Dune Analytics API:
1. Historical borrow rate retrieval using Query 3338148
2. Automated polling for async query execution
3. Data transformation to standard funding rate format
4. Support for all major Jupiter assets (SOL, ETH, WBTC, USDC, USDT)
5. Graceful degradation if API key not configured

## Configuration

✅ **Jupiter integration is fully implemented!** Follow these steps to enable it:

1. **Sign up for Dune Analytics**: https://dune.com
2. **Get your API key**: https://dune.com/settings/api
3. **Add to .env file** (recommended):
   ```bash
   # In backend/.env
   DUNE_API_KEY=your_dune_api_key_here
   ```

   Or **set environment variable**:
   ```bash
   export DUNE_API_KEY=your_dune_api_key_here
   ```
4. **Restart the backend server**

The implementation automatically:
- Fetches historical borrow rates via Dune Query 3338148
- Transforms data to match the standard funding rate format
- Supports all known Jupiter assets (SOL, ETH, WBTC, USDC, USDT)
- Handles polling for async query execution

## How to Enable Jupiter Integration (Advanced Options)

### Option A: Dune Analytics (✅ Implemented)
1. Sign up for Dune Analytics
2. Get API key (as described above)
3. Add to .env file
4. Data fetching works automatically

### Option B: Solana RPC (Advanced)
1. Set up Solana RPC access (Helius/QuickNode)
2. Implement Anchor IDL parsing
3. Query Pool/Custody accounts every hour
4. Calculate borrow rates from on-chain state
5. Store in database

### Option C: Wait for Community SDK
Monitor these repositories for updates:
- `jupiter-python-sdk` (currently shows Perps as "TO-DO")
- `jup-perps-client` (TypeScript, state reading only)

## References

- Official Docs: https://station.jup.ag/docs/perpetual-exchange/
- Dune Analytics: https://dune.com/browse/dashboards?q=jupiter+perps
- Program Address: `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- Academic Model: "Perpetual Demand Lending Pool (PDLP)"

## Recommendation

For most users, **defer Jupiter integration** until:
1. A community SDK provides historical borrow rate APIs, OR
2. You have budget for Dune Analytics Professional subscription, OR
3. You have dedicated blockchain engineering resources

The current platforms (Hyperliquid, Binance, Bybit, OKX, DyDx, GMX) provide sufficient coverage for multi-platform funding rate analysis.
