import { useState } from 'react';
import { useFundingRates } from '../hooks/useApi';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatDate, formatPercentage } from '../utils/formatters';

interface FundingRateChartProps {
  asset: string;
  platform: string;
}

export default function FundingRateChart({ asset, platform }: FundingRateChartProps) {
  const [dateRange, setDateRange] = useState<'7d' | '14d' | '30d' | 'all'>('7d');

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();

  if (dateRange === '7d') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (dateRange === '14d') {
    startDate.setDate(startDate.getDate() - 14);
  } else if (dateRange === '30d') {
    startDate.setDate(startDate.getDate() - 30);
  } else {
    startDate.setFullYear(startDate.getFullYear() - 1); // All data (max 1 year back)
  }

  const { data, isLoading, error } = useFundingRates({
    asset,
    platform,
    startDate: dateRange !== 'all' ? startDate : undefined,
    endDate,
    limit: 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading chart data...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-red-600">Failed to load chart data</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Funding Rate History: {asset}
        </h2>
        <p className="text-sm text-gray-500">No data available for this asset</p>
      </div>
    );
  }

  // Prepare chart data (reverse to show oldest to newest)
  const chartData = [...data]
    .reverse()
    .map((rate) => ({
      timestamp: new Date(rate.timestamp).getTime(),
      fundingRate: parseFloat(rate.funding_rate) * 100, // Convert to percentage
      formattedDate: formatDate(rate.timestamp, 'MMM dd HH:mm'),
    }));

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Funding Rate History: {asset}
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
              tickFormatter={(value) => `${value.toFixed(3)}%`}
              label={{ value: 'Funding Rate (%)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              labelFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd, yyyy HH:mm')}
              formatter={(value: number) => [`${value.toFixed(4)}%`, 'Funding Rate']}
            />
            <Legend />
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
