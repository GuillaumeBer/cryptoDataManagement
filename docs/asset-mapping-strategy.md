# Asset Mapping Strategy

The goal of this document is to elaborate a robust strategy to build a mapping table of equivalent assets across different platforms, even when their symbols/names are different.

## Strategy: Cross-Platform Asset Mapping via Price Correlation

The core idea is to determine if two assets from different platforms are the same by comparing their price history (OHLCV data). If two assets have a near-perfect price correlation over the same time period, we can confidently classify them as the same asset, even if their symbols differ.

Here is a step-by-step breakdown of the strategy:

1.  **Data Collection:**
    *   First, we will fetch all assets from all supported platforms stored in the local database.
    *   For each asset, we will retrieve its OHLCV (Open, High, Low, Close, Volume) data for a recent and significant time period (e.g., the last 15 days) at a consistent interval (e.g., 1 hour). A longer period with a consistent interval will provide a more reliable correlation.

2.  **Correlation Analysis:**
    *   We will use the Pearson correlation coefficient to measure the linear relationship between the closing prices of two assets. A value of `1` indicates a perfect positive correlation.
    *   To compare two assets, we will find the overlapping time window of their OHLCV data.
    *   We will calculate the correlation of their closing prices only within this overlapping window.

3.  **Matching and Grouping:**
    *   We'll set a very high correlation threshold (e.g., `> 0.99`) to define a match. This is critical to avoid false positives between assets that are correlated but not identical (like BTC and ETH).
    *   We will iterate through all assets and compare each one with every other asset from a different platform.
    *   When a match is found, we will group these assets together under a "canonical" or unified symbol. We'll use a simple normalization function on the symbol (e.g., removing `USDT`, `USD`, `-`, `_`) to propose a canonical name.

4.  **Building the Mapping Table:**
    *   The result of this analysis will be a mapping table that groups assets by a canonical name. The table will be structured as a JSON object where each key is the canonical asset name, and the value is an object containing the platform-specific symbols.

    **Example `asset-mappings.json`:**
    ```json
    {
      "BTC": {
        "platforms": {
          "binance": "BTCUSDT",
          "bybit": "BTCUSD",
          "hyperliquid": "BTC"
        }
      },
      "ETH": {
        "platforms": {
          "binance": "ETHUSDT",
          "bybit": "ETHUSD",
          "hyperliquid": "ETH"
        }
      }
    }
    ```

5.  **Persistence and Usage:**
    *   This mapping table will be saved to a file (`backend/data/asset-mappings.json`).
    *   A new service will be created to load this file on application startup.
    *   The mappings will also be persisted to the database using the `UnifiedAssetRepository` and `AssetMappingRepository`.
    *   A new API endpoint will be exposed to provide this unified asset data to the frontend for the "asset-centric view", filtered for assets that appear on at least three platforms.

## Implementation

A script named `buildAssetMappings.ts` will be created in `backend/src/scripts` to implement this strategy. This script will be executed manually or as a scheduled job to update the asset mappings periodically.