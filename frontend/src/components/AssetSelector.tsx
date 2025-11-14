import type { Asset } from '../types';

interface AssetSelectorProps {
  assets: Asset[];
  selectedAsset: string | null;
  onSelectAsset: (symbol: string | null) => void;
}

export default function AssetSelector({
  assets,
  selectedAsset,
  onSelectAsset,
}: AssetSelectorProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Asset</h2>

      {assets.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">
            No assets available. Click "Fetch Initial Data" to load assets.
          </p>
        </div>
      ) : (
        <div>
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search assets..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              onChange={(e) => {
                // Simple search filter
                const searchTerm = e.target.value.toLowerCase();
                const filtered = assets.filter((a) =>
                  a.symbol.toLowerCase().includes(searchTerm)
                );
                // Could implement search filtering here
              }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-96 overflow-y-auto">
            {assets.map((asset) => {
              // Determine staleness badge color
              const getStalenessColor = (days?: number) => {
                if (!days || days === 999) return null; // No data
                if (days <= 1) return null; // Fresh, no badge needed
                if (days <= 3) return 'bg-yellow-500'; // Somewhat stale
                return 'bg-red-500'; // Very stale
              };

              const stalenessColor = getStalenessColor(asset.daysStale);
              const showStaleness = asset.daysStale && asset.daysStale > 1 && asset.daysStale !== 999;

              return (
                <button
                  key={asset.id}
                  onClick={() =>
                    onSelectAsset(selectedAsset === asset.symbol ? null : asset.symbol)
                  }
                  className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    selectedAsset === asset.symbol
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {asset.symbol}
                  {showStaleness && (
                    <span
                      className={`absolute -top-1 -right-1 ${stalenessColor} text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center`}
                      title={`Data is ${asset.daysStale} days old`}
                    >
                      {asset.daysStale}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
