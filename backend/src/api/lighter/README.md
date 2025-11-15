# Lighter PERPS API Integration

## Overview

This module implements integration with Lighter Protocol's perpetual futures (PERPS) funding rate data.

## API Details

**Base URL:** `https://mainnet.zklighter.elliot.ai`
**Documentation:** https://apidocs.lighter.xyz

## Funding Rate Characteristics

### Unique Features of Lighter Funding Rates

1. **Hourly Frequency:** Unlike most CEXs that use 8-hour intervals, Lighter pays funding **every hour**.

2. **TWAP Calculation:**
   - Premium is sampled every minute
   - Final rate is Time-Weighted Average Price (TWAP) of 60 minute-level premiums
   - This provides smoother rates compared to spot sampling

3. **Rate Capping:** Funding rates are clamped to `[-0.5%, +0.5%]` per hour

4. **Formula:**
   ```
   fundingRate = (premium / 8) + interestRateComponent
   Then clamped to [-0.5%, +0.5%]
   ```

5. **Sampling Interval:** Data is stored with `sampling_interval = '1h'` to reflect hourly payments

## Implementation Details

### Endpoints Used

#### 1. Assets Endpoint (Placeholder)
```
GET /api/v1/exchangeInfo
```
**Note:** This endpoint is a placeholder and may need updating when official documentation is available.

#### 2. Funding Rates Endpoint
```
GET /api/v1/fundings
```

**Parameters (Inferred - Not Officially Documented):**
- `market_id` (string): Market identifier (e.g., "ETH-PERP", "BTC-PERP")
- `start_time` (number): Unix timestamp in milliseconds
- `end_time` (number): Unix timestamp in milliseconds
- `limit` (number): Maximum records to return (max: 1000)

**⚠️ WARNING:** These parameter names are **inferred** based on industry standards. They are not officially documented and may change without notice.

### Response Format

The API response format is also undocumented. The client handles multiple possible field names:

```typescript
{
  // Possible timestamp fields
  timestamp?: number,
  fundingTime?: number,

  // Possible rate fields
  fundingRate?: string,
  rate?: string,

  // Possible market identifier fields
  market_id?: string,
  symbol?: string,

  // Optional fields
  premium?: string,
  markPrice?: string
}
```

## Data Depth

**Historical Data:** 480 hours (20 days)
- Matches Hyperliquid's depth for consistency
- At 1-hour intervals = 480 data points per asset

## Rate Limiting

- Conservative delay: 100ms between requests (default)
- Recommended: Monitor for 429 responses and adjust accordingly

## Important Caveats

### 1. Undocumented API

The Lighter API lacks comprehensive documentation for historical data endpoints:
- ❌ Parameter names are inferred, not confirmed
- ❌ Response schema is flexible to handle variations
- ❌ No official rate limit documentation

### 2. Fragile Integration

**This integration is considered "high-risk fragile":**
- API changes could break the integration without warning
- Field names in responses may vary
- No official TypeScript/JavaScript SDK available

### 3. Recommended Monitoring

For production use, implement:
1. **Response validation** - Log unexpected response structures
2. **Error tracking** - Monitor failed requests closely
3. **Fallback logic** - Handle missing fields gracefully
4. **Regular testing** - Verify integration still works after any Lighter updates

## Comparison with Other Platforms

| Platform   | Interval | Native Rate | Stored As | Notes |
|------------|----------|-------------|-----------|-------|
| Hyperliquid| 1h       | 8h (paid 1/8th hourly) | Both 1h and 8h | Resampled to 8h for comparison |
| Binance    | 8h       | 8h          | 8h        | Tri-daily: 00:00, 08:00, 16:00 UTC |
| **Lighter**| **1h**   | **1h**      | **1h**    | **Hourly funding, TWAP, capped** |

## Usage Example

```typescript
import LighterClient from './api/lighter/client';

const client = new LighterClient();

// Fetch assets
const assets = await client.getAssets();

// Fetch funding history for a market
const fundingData = await client.getFundingHistory('ETH-PERP');

// Batch fetch with progress callback
const batch = await client.getFundingHistoryBatch(
  ['ETH-PERP', 'BTC-PERP'],
  100, // 100ms delay
  (symbol, processed) => {
    console.log(`Processed ${symbol}: ${processed} done`);
  }
);
```

## Testing Recommendations

1. **Test with a single market first** to validate API responses
2. **Log full responses** for the first few successful calls
3. **Verify timestamp format** (milliseconds vs seconds)
4. **Check rate values** are within expected range [-0.5%, +0.5%]

## Future Improvements

For institutional use, consider:

1. **Building a custom indexer** using TheGraph to index Lighter's on-chain state
2. **Engaging with Lighter team** to request official API documentation
3. **Monitoring Lighter's GitHub** for any SDK releases or API updates
4. **Community engagement** on Lighter Discord/Telegram for API clarifications

## References

- [Lighter API Docs](https://apidocs.lighter.xyz)
- [Lighter Documentation](https://docs.lighter.xyz)
- [Lighter Protocol](https://lighter.xyz)
- Technical Analysis: [Provided by user - comprehensive reverse-engineering analysis]

## Support

For issues related to this integration:
1. Check Lighter API status: https://mainnet.zklighter.elliot.ai/api/v1/health
2. Review logs for specific error messages
3. Test with reduced batch sizes if rate limiting occurs

**Last Updated:** 2025-11-15
