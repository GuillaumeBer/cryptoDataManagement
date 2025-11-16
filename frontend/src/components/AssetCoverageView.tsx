import { useMemo, useState } from 'react';
import type { Asset } from '../types';
import { PLATFORMS } from '../constants/platforms';

interface AssetCoverageViewProps {
  assets?: Asset[];
  isLoading?: boolean;
  error?: unknown;
}

interface AggregatedAsset {
  symbol: string;
  platforms: string[];
  minDaysStale?: number;
}

const platformNames = Object.fromEntries(PLATFORMS.map((platform) => [platform.id, platform.name]));
const totalEnabledPlatforms = PLATFORMS.filter((platform) => platform.enabled).length || PLATFORMS.length;

function getFreshnessStyles(days?: number) {
  if (days === undefined || days === 999) {
    return { label: 'Awaiting data', className: 'bg-gray-100 text-gray-600' };
  }
  if (days <= 1) {
    return { label: 'Updated today', className: 'bg-green-100 text-green-700' };
  }
  if (days <= 3) {
    return { label: `${days}d old`, className: 'bg-yellow-100 text-yellow-700' };
  }
  return { label: `${days}d old`, className: 'bg-red-100 text-red-700' };
}

export default function AssetCoverageView({ assets, isLoading, error }: AssetCoverageViewProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const aggregatedAssets = useMemo<AggregatedAsset[]>(() => {
    if (!assets?.length) return [];

    const grouped = new Map<string, AggregatedAsset>();

    assets.forEach((asset) => {
      const symbol = asset.symbol.toUpperCase();
      const existing = grouped.get(symbol) ?? { symbol, platforms: [], minDaysStale: undefined };

      if (!existing.platforms.includes(asset.platform)) {
        existing.platforms.push(asset.platform);
      }

      const days = asset.daysStale ?? 999;
      if (existing.minDaysStale === undefined || days < existing.minDaysStale) {
        existing.minDaysStale = days;
      }

      grouped.set(symbol, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => {
      if (b.platforms.length === a.platforms.length) {
        return a.symbol.localeCompare(b.symbol);
      }
      return b.platforms.length - a.platforms.length;
    });
  }, [assets]);

  const filteredAssets = useMemo(() => {
    if (!searchTerm) return aggregatedAssets;
    return aggregatedAssets.filter((asset) =>
      asset.symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [aggregatedAssets, searchTerm]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Asset-centric view
          </p>
          <h2 className="text-xl font-semibold text-gray-900 mt-1">Cross-platform coverage</h2>
          <p className="text-sm text-gray-500 mt-1">
            Understand which symbols exist on each venue today. Future metrics like open interest, volume and OHLCV
            will reuse the same coverage map so the layout is already multi-metric friendly.
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold">
          Funding rate live
        </span>
      </div>

      <div className="mt-5">
        <label className="sr-only" htmlFor="asset-coverage-search">
          Search assets
        </label>
        <input
          id="asset-coverage-search"
          type="text"
          placeholder="Search assets across platforms..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          Showing {filteredAssets.length} of {aggregatedAssets.length} aggregated symbols
        </p>
      </div>

      <div className="mt-4 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-500">Loading asset overview...</p>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-red-600">Unable to load assets.</p>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-500">No assets match "{searchTerm}".</p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <tr>
                  <th className="px-4 py-2">Asset</th>
                  <th className="px-4 py-2">Platforms</th>
                  <th className="px-4 py-2">Coverage</th>
                  <th className="px-4 py-2">Freshness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAssets.map((asset) => {
                  const freshness = getFreshnessStyles(asset.minDaysStale);
                  const coveragePercent = Math.round((asset.platforms.length / totalEnabledPlatforms) * 100);

                  return (
                    <tr key={asset.symbol}>
                      <td className="px-4 py-3 font-semibold text-gray-900">{asset.symbol}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {asset.platforms.map((platform) => (
                            <span
                              key={`${asset.symbol}-${platform}`}
                              className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"
                            >
                              {platformNames[platform] ?? platform}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-500 mb-1">
                          {asset.platforms.length} / {totalEnabledPlatforms} venues
                        </p>
                        <div className="h-2 rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${coveragePercent}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${freshness.className}`}>
                          {freshness.label}
                        </span>
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
