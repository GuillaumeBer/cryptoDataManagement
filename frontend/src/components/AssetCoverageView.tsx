import { useMemo, useState } from 'react';
import type { UnifiedAsset } from '../types';
import { PLATFORMS } from '../constants/platforms';
import { useUnifiedAssets } from '../hooks/useUnifiedAssets';

const platformNames = Object.fromEntries(PLATFORMS.map((platform) => [platform.id, platform.name]));
const totalEnabledPlatforms = PLATFORMS.filter((platform) => platform.enabled).length || PLATFORMS.length;

export default function AssetCoverageView() {
  const [searchTerm, setSearchTerm] = useState('');
  const { assets, isLoading, error } = useUnifiedAssets({ minPlatforms: 3 });

  const filteredAssets = useMemo(() => {
    if (!searchTerm) return assets;
    const searchLower = searchTerm.toLowerCase();
    return assets.filter((asset) =>
      asset.normalized_symbol.toLowerCase().includes(searchLower) ||
      asset.display_name?.toLowerCase().includes(searchLower) ||
      asset.coingecko_name?.toLowerCase().includes(searchLower)
    );
  }, [assets, searchTerm]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Asset-centric view
          </p>
          <h2 className="text-xl font-semibold text-gray-900 mt-1">Multi-platform assets</h2>
          <p className="text-sm text-gray-500 mt-1">
            Assets available on 3 or more platforms, with standardized names from CoinGecko.
            Price correlation validation ensures accurate cross-platform matching.
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 font-semibold">
          3+ platforms
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
          Showing {filteredAssets.length} of {assets.length} multi-platform assets
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
        ) : filteredAssets.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-500">
              {searchTerm ? `No assets match "${searchTerm}"` : 'No multi-platform assets found'}
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <tr>
                  <th className="px-4 py-2">Asset</th>
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2">Platforms</th>
                  <th className="px-4 py-2">Coverage</th>
                  <th className="px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAssets.map((asset) => {
                  const displayName = asset.display_name || asset.coingecko_name || asset.normalized_symbol;
                  const coveragePercent = Math.round((asset.platform_count / totalEnabledPlatforms) * 100);
                  const correlationValue = asset.avg_correlation ? Number(asset.avg_correlation) : null;
                  const hasCorrelation = correlationValue !== null && correlationValue > 0;

                  return (
                    <tr key={asset.id}>
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
