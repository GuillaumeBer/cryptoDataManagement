# Aster Finance Futures V3 API Integration

## Status: Configuration Required ⚠️

The Aster Finance integration is implemented but requires the correct API base URL to be configured.

## Issue

The default endpoint `https://api.asterdex.com` is not resolving (DNS ENOTFOUND error). This could mean:
- The public API is not yet available
- A different base URL is required
- Access requires authentication or whitelisting

## Documentation

According to the research:
- **Documentation**: github.com/asterdex/api-docs (aster-finance-futures-api-v3.md)
- **API Structure**: Nearly identical to Binance USDM Futures API
- **Endpoints**:
  - `/fapi/v1/exchangeInfo` - Get perpetual contracts
  - `/fapi/v1/fundingRate` - Get funding rate history

## Configuration

To use Aster Finance, set the correct base URL in your `.env` file:

```bash
ASTER_API_URL=https://your-actual-aster-api-url.com
```

## Alternative Data Sources

If direct API access is not available, consider:

1. **CoinAPI** (Professional):
   - Aster is supported as "ASTERFINANCE"
   - Historical data available from 2025-05-21
   - Requires paid subscription

2. **Existing Client Libraries**:
   - JavaScript/TypeScript: `Zysen/node-aster-api`
   - C#: `JKorf/Aster.Net`

## Implementation Details

- **Funding Interval**: 1 hour (similar to Hyperliquid)
- **Historical Depth**: 480 hours (480 funding periods)
- **Rate Limiting**: 200ms delay between requests
- **Response Format**: Binance-compatible JSON structure

## References

- API Docs: https://github.com/asterdex/api-docs
- CoinAPI Integration: Listed as supported exchange
- Compatible with Binance USDM Futures API patterns
