import { useState } from 'react';
import { useSystemStatus, useAssets } from '../hooks/useApi';
import AssetSelector from './AssetSelector';
import FundingRateChart from './FundingRateChart';
import Analytics from './Analytics';
import DataFetcher from './DataFetcher';
import StatusBar from './StatusBar';
import SchedulerWidget from './SchedulerWidget';
import { PLATFORMS, type Platform } from '../constants/platforms';

export default function Dashboard() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('hyperliquid');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const {
    data: status,
    isLoading: isStatusLoading,
    error: statusError,
  } = useSystemStatus(selectedPlatform);
  const {
    data: assets,
    isLoading: isAssetsLoading,
    error: assetsError,
  } = useAssets(selectedPlatform);

  // Reset selected asset when switching platforms
  const handlePlatformChange = (platform: Platform) => {
    setSelectedPlatform(platform);
    setSelectedAsset(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-3xl font-bold text-gray-900">
            Crypto Data Management
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Historical funding rate data from multiple platforms
          </p>
        </div>
      </header>

      {/* Status Bar */}
      <StatusBar status={status} isLoading={isStatusLoading} error={statusError} />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SchedulerWidget scheduler={status?.scheduler} recentErrors={status?.recentErrors} />
        {/* Platform Tabs */}
        <div className="mb-8 bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
              {PLATFORMS.map((platform) => (
                <button
                  key={platform.id}
                  onClick={() => platform.enabled && handlePlatformChange(platform.id)}
                  disabled={!platform.enabled}
                  className={`
                    whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                    ${selectedPlatform === platform.id
                      ? 'border-blue-500 text-blue-600'
                      : platform.enabled
                      ? 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      : 'border-transparent text-gray-300 cursor-not-allowed'
                    }
                  `}
                >
                  {platform.name}
                  {!platform.enabled && (
                    <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      Soon
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Data Fetcher Section */}
        <div className="mb-8">
          <DataFetcher platform={selectedPlatform} selectedAsset={selectedAsset} />
        </div>

        {/* Asset Selection */}
        <div className="mb-8">
          <AssetSelector
            assets={assets || []}
            isLoading={isAssetsLoading}
            error={assetsError}
            selectedAsset={selectedAsset}
            onSelectAsset={setSelectedAsset}
          />
        </div>

        {/* Charts and Analytics */}
        {selectedAsset && (
          <div className="space-y-8">
            <Analytics asset={selectedAsset} platform={selectedPlatform} />
            <FundingRateChart asset={selectedAsset} platform={selectedPlatform} />
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
