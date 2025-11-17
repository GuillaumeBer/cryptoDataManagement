import { useState } from 'react';
import { useSystemStatus, useAssets } from '../hooks/useApi';
import AssetSelector from './AssetSelector';
import FundingRateChart from './FundingRateChart';
import OHLCVChart from './OHLCVChart';
import Analytics from './Analytics';
import DataFetcher from './DataFetcher';
import StatusBar from './StatusBar';
import SchedulerWidget from './SchedulerWidget';
import AssetCoverageView from './AssetCoverageView';
import { PLATFORMS, type Platform } from '../constants/platforms';

const METRICS_ROADMAP = [
  { id: 'funding', label: 'Funding rate', state: 'Live now' },
  { id: 'oi', label: 'Open interest', state: 'Designing' },
  { id: 'volume', label: 'Perpetual volume', state: 'Planned' },
  { id: 'ohlcv', label: 'OHLCV', state: 'Exploring' },
];

const badgeStyles: Record<string, string> = {
  'Live now': 'border-green-200 bg-green-50 text-green-700',
  Designing: 'border-blue-200 bg-blue-50 text-blue-700',
  Planned: 'border-yellow-200 bg-yellow-50 text-yellow-700',
  Exploring: 'border-gray-200 bg-gray-50 text-gray-600',
};

type DashboardTab = 'global' | 'platform';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('global');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('hyperliquid');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const {
    data: globalStatus,
  } = useSystemStatus();
  const {
    data: status,
    isLoading: isStatusLoading,
    error: statusError,
  } = useSystemStatus(selectedPlatform);
  const {
    data: platformAssets,
    isLoading: isAssetsLoading,
    error: assetsError,
  } = useAssets(selectedPlatform);
  const {
    data: allAssets,
    isLoading: isAllAssetsLoading,
    error: allAssetsError,
  } = useAssets();

  // Reset selected asset when switching platforms
  const handlePlatformChange = (platform: Platform) => {
    setSelectedPlatform(platform);
    setSelectedAsset(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-gray-900">Crypto Data Management</h1>
          <p className="mt-2 text-sm text-gray-600 max-w-3xl">
            Operate a unified data plane for every derivatives venue. Funding rates are live today, while the layout
            already anticipates open interest, volume, OHLCV and other metrics so controls stay familiar as coverage
            expands.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {METRICS_ROADMAP.map((metric) => (
              <span
                key={metric.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                  badgeStyles[metric.state]
                }`}
              >
                <span className="uppercase tracking-wide text-[10px] text-gray-500">{metric.state}</span>
                <span className="text-gray-900 capitalize">{metric.label}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-8" aria-label="Main navigation">
            <button
              onClick={() => setActiveTab('global')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'global'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Global Overview
              </div>
            </button>
            <button
              onClick={() => setActiveTab('platform')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'platform'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
                Platform Workspace
              </div>
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="px-4 sm:px-6 lg:px-8 py-10 space-y-12">
        {/* Global overview */}
        {activeTab === 'global' && (
        <section>
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-1 w-12 bg-gradient-to-r from-blue-500 to-blue-300 rounded-full"></div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Global overview</p>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">Scheduling & cross-platform coverage</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-3xl">
              Monitor automated data ingestion health and view asset availability across all platforms. This section provides a bird's-eye view of your entire data pipeline, independent of any specific venue.
            </p>
          </div>
          <div className="space-y-6">
            <SchedulerWidget scheduler={globalStatus?.scheduler} recentErrors={globalStatus?.recentErrors} />
            <AssetCoverageView
              assets={allAssets}
              isLoading={isAllAssetsLoading}
              error={allAssetsError}
            />
          </div>
        </section>
        )}

        {/* Platform workspace */}
        {activeTab === 'platform' && (
        <section>
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-1 w-12 bg-gradient-to-r from-purple-500 to-purple-300 rounded-full"></div>
              <p className="text-xs font-semibold uppercase tracking-wide text-purple-600">Platform workspace</p>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">Venue-specific exploration</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-3xl">
              Select a platform to trigger data fetches, browse available instruments, and analyze funding rate trends. All elements in this section are specific to your currently selected venue.
            </p>
          </div>

          {/* Platform Tabs */}
          <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <nav className="flex flex-wrap gap-2" aria-label="Platform tabs">
              {PLATFORMS.map((platform) => (
                <button
                  key={platform.id}
                  onClick={() => platform.enabled && handlePlatformChange(platform.id)}
                  disabled={!platform.enabled}
                  className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                    selectedPlatform === platform.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : platform.enabled
                      ? 'border-gray-200 text-gray-600 hover:text-gray-900'
                      : 'border-dashed border-gray-200 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {platform.name}
                  {!platform.enabled && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide">Soon</span>
                  )}
                </button>
              ))}
            </nav>

            {/* Platform Status Bar */}
            <div className="mt-4 -mx-4 -mb-4">
              <StatusBar status={status} isLoading={isStatusLoading} error={statusError} />
            </div>
          </div>

          {/* Platform Content */}
          <div className="mt-6 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <DataFetcher platform={selectedPlatform} selectedAsset={selectedAsset} />
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <AssetSelector
                assets={platformAssets || []}
                isLoading={isAssetsLoading}
                error={assetsError}
                selectedAsset={selectedAsset}
                onSelectAsset={setSelectedAsset}
              />
            </div>

            {selectedAsset ? (
              <>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <Analytics asset={selectedAsset} platform={selectedPlatform} />
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <FundingRateChart asset={selectedAsset} platform={selectedPlatform} />
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <OHLCVChart asset={selectedAsset} platform={selectedPlatform} />
                </div>
              </>
            ) : (
              <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-dashed border-gray-200">
                <svg
                  className="mx-auto h-12 w-12 text-gray-300"
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
                <h3 className="mt-3 text-base font-medium text-gray-900">Select an asset to explore</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Choose an asset from the asset selector to view analytics and funding rate charts. The asset coverage widget
                  in the Global Overview tab shows what is available across every venue.
                </p>
              </div>
            )}
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
