import { useMemo, useState } from 'react';
import type { UnifiedAsset } from '../types';
import { PLATFORMS } from '../constants/platforms';
import { useUnifiedAssets } from '../hooks/useUnifiedAssets';

const platformNames = Object.fromEntries(PLATFORMS.map((platform) => [platform.id, platform.name]));
const totalEnabledPlatforms = PLATFORMS.filter((platform) => platform.enabled).length || PLATFORMS.length;

type SortField = 'asset' | 'symbol' | 'marketCap' | 'rank';
type SortDirection = 'asc' | 'desc';

function formatMarketCap(marketCap: number | null): string {
  if (!marketCap) return 'N/A';

  const trillion = 1_000_000_000_000;
  const billion = 1_000_000_000;
  const million = 1_000_000;

  if (marketCap >= trillion) {
    return `$${(marketCap / trillion).toFixed(2)}T`;
  } else if (marketCap >= billion) {
    return `$${(marketCap / billion).toFixed(2)}B`;
  } else if (marketCap >= million) {
    return `$${(marketCap / million).toFixed(2)}M`;
  } else {
    return `$${marketCap.toLocaleString()}`;
  }
}

export default function AssetCoverageView() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('marketCap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { assets, isLoading, error } = useUnifiedAssets({ minPlatforms: 2 });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking the same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field with default direction
      setSortField(field);
      // Market cap defaults to desc (highest first), rank defaults to asc (lowest number = highest rank)
      setSortDirection(field === 'marketCap' ? 'desc' : field === 'rank' ? 'asc' : 'asc');
    }
  };

  const filteredAndSortedAssets = useMemo(() => {
    let filtered = assets;

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = assets.filter((asset) =>
        asset.normalized_symbol.toLowerCase().includes(searchLower) ||
        asset.display_name?.toLowerCase().includes(searchLower) ||
        asset.coingecko_name?.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'asset': {
          const aName = (a.display_name || a.coingecko_name || a.normalized_symbol).toLowerCase();
          const bName = (b.display_name || b.coingecko_name || b.normalized_symbol).toLowerCase();
          comparison = aName.localeCompare(bName);
          break;
        }
        case 'symbol': {
          comparison = a.normalized_symbol.localeCompare(b.normalized_symbol);
          break;
        }
        case 'marketCap': {
          const aMarketCap = a.market_cap_usd ?? 0;
          const bMarketCap = b.market_cap_usd ?? 0;
          comparison = aMarketCap - bMarketCap;
          break;
        }
        case 'rank': {
          // Lower rank number = better (e.g. #1 is best)
          // Treat null as infinity (worst rank)
          const aRank = a.market_cap_rank ?? Infinity;
          const bRank = b.market_cap_rank ?? Infinity;
          comparison = aRank - bRank;
          break;
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [assets, searchTerm, sortField, sortDirection]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Asset-centric view
          </p>
          <h2 className="text-xl font-semibold text-gray-900 mt-1">Multi-platform assets</h2>
          <p className="text-sm text-gray-500 mt-1">
            Assets available on 2 or more platforms, with standardized names from CoinGecko.
            Price correlation validation ensures accurate cross-platform matching.
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 font-semibold">
          2+ platforms
        </span>
      </div>

      <div className="mt-5">
        <label className="sr-only" htmlFor="asset-coverage-search">
          Search assets
        </label>
        <input
          id="asset-coverage-search"
          type="text"
          placeholder="Search by name or symbol..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          Showing {filteredAndSortedAssets.length} of {assets.length} multi-platform assets
        </p>
      </div>

      <div className="mt-4 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading multi-platform assets...</p>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-red-600">Unable to load assets: {error.message}</p>
          </div>
        ) : filteredAndSortedAssets.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-500">
              {searchTerm ? `No assets match "${searchTerm}"` : 'No multi-platform assets found'}
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 sticky top-0 z-10">
                <tr>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Rank</span>
                      <span className="flex flex-col leading-none">
                        <span className={sortField === 'rank' && sortDirection === 'asc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↑</span>
                        <span className={sortField === 'rank' && sortDirection === 'desc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↓</span>
                      </span>
                    </div>
                  </th>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('asset')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Asset</span>
                      <span className="flex flex-col leading-none">
                        <span className={sortField === 'asset' && sortDirection === 'asc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↑</span>
                        <span className={sortField === 'asset' && sortDirection === 'desc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↓</span>
                      </span>
                    </div>
                  </th>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('symbol')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Symbol</span>
                      <span className="flex flex-col leading-none">
                        <span className={sortField === 'symbol' && sortDirection === 'asc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↑</span>
                        <span className={sortField === 'symbol' && sortDirection === 'desc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↓</span>
                      </span>
                    </div>
                  </th>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('marketCap')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Market Cap</span>
                      <span className="flex flex-col leading-none">
                        <span className={sortField === 'marketCap' && sortDirection === 'asc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↑</span>
                        <span className={sortField === 'marketCap' && sortDirection === 'desc' ? 'text-blue-600 font-bold' : 'text-gray-300'}>↓</span>
                      </span>
                    </div>
                  </th>
                  <th className="px-4 py-2">Platforms</th>
                  <th className="px-4 py-2">Coverage</th>
                  <th className="px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAndSortedAssets.map((asset) => {
                  const displayName = asset.display_name || asset.coingecko_name || asset.normalized_symbol;
                  const coveragePercent = Math.round((asset.platform_count / totalEnabledPlatforms) * 100);
                  const correlationValue = asset.avg_correlation ? Number(asset.avg_correlation) : null;
                  const hasCorrelation = correlationValue !== null && correlationValue > 0;

                  return (
                    <tr key={asset.id}>
                      <td className="px-4 py-3">
                        {asset.market_cap_rank ? (
                          <span className="font-semibold text-blue-600">
                            #{asset.market_cap_rank}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-sm">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-gray-900">{displayName}</p>
                          {asset.coingecko_id && (
                            <p className="text-xs text-gray-500 mt-0.5">via CoinGecko</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                          {asset.normalized_symbol}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${asset.market_cap_usd ? 'text-gray-900' : 'text-gray-400'}`}>
                          {formatMarketCap(asset.market_cap_usd)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {asset.platforms.map((platform) => (
                            <span
                              key={`${asset.id}-${platform}`}
                              className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"
                            >
                              {platformNames[platform] ?? platform}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-500 mb-1">
                          {asset.platform_count} / {totalEnabledPlatforms} platforms
                        </p>
                        <div className="h-2 rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${coveragePercent}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            asset.avg_confidence >= 98 ? 'bg-green-100 text-green-700' :
                            asset.avg_confidence >= 90 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {asset.avg_confidence}% confidence
                          </span>
                          {hasCorrelation && correlationValue && (
                            <span className="text-xs text-gray-500">
                              r={correlationValue.toFixed(3)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
