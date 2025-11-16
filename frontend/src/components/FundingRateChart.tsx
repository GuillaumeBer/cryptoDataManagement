import { useState, useMemo } from 'react';
import { useFundingRates } from '../hooks/useApi';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { formatDate, formatPercentage } from '../utils/formatters';

interface FundingRateChartProps {
  asset: string;
  platform: string;
}

const fractionToPercentValue = (value: number | string) => {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  return numericValue * 100;
};

export default function FundingRateChart({ asset, platform }: FundingRateChartProps) {
  const [dateRange, setDateRange] = useState<'7d' | '14d' | '30d' | 'all'>('7d');

  // Determine appropriate sampling interval based on platform
  const samplingInterval = useMemo(() => {
    // Binance, Bybit, OKX use 8h intervals natively
    if (['binance', 'bybit', 'okx'].includes(platform.toLowerCase())) {
      return '8h';
    }
    // Hyperliquid and others use 1h intervals
    // Note: Hyperliquid can be resampled to 8h for comparison, but we'll use 1h as default
    return '1h';
  }, [platform]);

  // Calculate date range - memoize to prevent infinite re-renders
  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    const start = new Date();

    if (dateRange === '7d') {
      start.setDate(start.getDate() - 7);
    } else if (dateRange === '14d') {
      start.setDate(start.getDate() - 14);
    } else if (dateRange === '30d') {
      start.setDate(start.getDate() - 30);
    } else {
      start.setFullYear(start.getFullYear() - 1); // All data (max 1 year back)
    }

    return { startDate: start, endDate: end };
  }, [dateRange]);

  const { data, isLoading, error } = useFundingRates({
    asset,
    platform,
    startDate: dateRange !== 'all' ? startDate : undefined,
    endDate,
    sampling_interval: samplingInterval,
    limit: 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading chart data for {asset}...</p>
        <p className="text-xs text-gray-400 mt-2">
          Fetching from: {dateRange !== 'all' ? startDate.toISOString().split('T')[0] : 'beginning'}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-red-600">Failed to load chart data</p>
        {error && (
          <p className="text-xs text-red-500 mt-2">
            Error: {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Funding Rate History: {asset}
        </h2>
        <p className="text-sm text-gray-500">No data available for this asset on {platform}</p>
        <p className="text-xs text-gray-400 mt-2">
          {platform.toLowerCase() === 'binance'
            ? `Binance uses 8-hour funding intervals. Make sure you've fetched data for ${platform}.`
            : `This platform uses ${samplingInterval} funding intervals. Make sure you've fetched data for ${platform}.`}
        </p>
      </div>
    );
  }

  // Prepare chart data (reverse to show oldest to newest)
  const chartData = [...data]
    .reverse()
    .map((rate) => ({
      timestamp: new Date(rate.timestamp).getTime(),
      fundingRate: fractionToPercentValue(rate.funding_rate),
      formattedDate: formatDate(rate.timestamp, 'MMM dd HH:mm'),
    }));

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Funding Rate History: {asset} <span className="text-sm font-normal text-gray-500">(8-hour intervals)</span>
        </h2>

        {/* Date Range Selector */}
        <div className="flex gap-2">
          {(['7d', '14d', '30d', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                dateRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range === 'all' ? 'All' : range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd')}
            />
            <YAxis
              tickFormatter={(value) => formatPercentage(value, 3)}
              label={{ value: 'Funding Rate (%)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              labelFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd, yyyy HH:mm')}
              formatter={(value: number) => [formatPercentage(value, 4), 'Funding Rate']}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" strokeWidth={2} label={{ value: '0%', position: 'right' }} />
            <Line
              type="monotone"
              dataKey="fundingRate"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              name="Funding Rate"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        Showing {data.length} data points
      </div>
    </div>
  );
}
