import { useState } from 'react';
import { useSystemStatus, useAssets } from '../hooks/useApi';
import AssetSelector from './AssetSelector';
import FundingRateChart from './FundingRateChart';
import Analytics from './Analytics';
import DataFetcher from './DataFetcher';
import StatusBar from './StatusBar';

export default function Dashboard() {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const { data: status } = useSystemStatus();
  const { data: assets } = useAssets('hyperliquid');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-3xl font-bold text-gray-900">
            Crypto Data Management
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Historical funding rate data from Hyperliquid
          </p>
        </div>
      </header>

      {/* Status Bar */}
      <StatusBar status={status} />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Data Fetcher Section */}
        <div className="mb-8">
          <DataFetcher />
        </div>

        {/* Asset Selection */}
        <div className="mb-8">
          <AssetSelector
            assets={assets || []}
            selectedAsset={selectedAsset}
            onSelectAsset={setSelectedAsset}
          />
        </div>

        {/* Charts and Analytics */}
        {selectedAsset && (
          <div className="space-y-8">
            <Analytics asset={selectedAsset} platform="hyperliquid" />
            <FundingRateChart asset={selectedAsset} platform="hyperliquid" />
          </div>
        )}

        {/* No Asset Selected State */}
        {!selectedAsset && (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No asset selected</h3>
            <p className="mt-1 text-sm text-gray-500">
              Select an asset above to view funding rate data and analytics
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
