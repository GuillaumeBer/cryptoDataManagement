import { useAssetAnalytics } from '../hooks/useApi';
import { formatPercentage, formatDate } from '../utils/formatters';

interface AnalyticsProps {
  asset: string;
  platform: string;
}

export default function Analytics({ asset, platform }: AnalyticsProps) {
  const { data, isLoading, error } = useAssetAnalytics(asset, platform);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading analytics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-red-600">Failed to load analytics</p>
      </div>
    );
  }

  const positivePercentage = (data.positive_count / data.total_records) * 100;
  const negativePercentage = (data.negative_count / data.total_records) * 100;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Analytics: {data.symbol}
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Records */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Total Records</p>
          <p className="text-2xl font-bold text-gray-900">{data.total_records}</p>
        </div>

        {/* Average Funding Rate */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Average Rate</p>
          <p className={`text-2xl font-bold ${parseFloat(data.avg_funding_rate) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatPercentage(data.avg_funding_rate)}
          </p>
        </div>

        {/* Min Funding Rate */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Min Rate</p>
          <p className="text-2xl font-bold text-red-600">
            {formatPercentage(data.min_funding_rate)}
          </p>
        </div>

        {/* Max Funding Rate */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Max Rate</p>
          <p className="text-2xl font-bold text-green-600">
            {formatPercentage(data.max_funding_rate)}
          </p>
        </div>

        {/* Standard Deviation */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Std Dev</p>
          <p className="text-2xl font-bold text-gray-900">
            {formatPercentage(data.std_dev)}
          </p>
        </div>

        {/* Positive/Negative Split */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Positive Rate</p>
          <p className="text-2xl font-bold text-green-600">
            {positivePercentage.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {data.positive_count} records
          </p>
        </div>

        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Negative Rate</p>
          <p className="text-2xl font-bold text-red-600">
            {negativePercentage.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {data.negative_count} records
          </p>
        </div>

        {/* Date Range */}
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Data Range</p>
          <p className="text-sm font-medium text-gray-900">
            {formatDate(data.first_timestamp, 'MMM dd')}
          </p>
          <p className="text-xs text-gray-400">to</p>
          <p className="text-sm font-medium text-gray-900">
            {formatDate(data.last_timestamp, 'MMM dd')}
          </p>
        </div>
      </div>
    </div>
  );
}
