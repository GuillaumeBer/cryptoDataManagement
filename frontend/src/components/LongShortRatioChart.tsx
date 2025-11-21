import { useState, useMemo } from 'react';
import { useLongShortRatios } from '../hooks/useApi';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, Area, AreaChart } from 'recharts';
import { formatDate, formatNumber } from '../utils/formatters';

interface LongShortRatioChartProps {
  asset: string;
  platform: string;
}

export default function LongShortRatioChart({ asset, platform }: LongShortRatioChartProps) {
  const [dateRange, setDateRange] = useState<'7d' | '14d' | '30d' | 'all'>('7d');

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

  const { data, isLoading, error } = useLongShortRatios({
    asset,
    platform,
    startDate: dateRange !== 'all' ? startDate : undefined,
    endDate,
    timeframe: '1h', // Default to 1h, but backend might return other intervals depending on platform
    limit: 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading Long/Short Ratio data for {asset}...</p>
        <p className="text-xs text-gray-400 mt-2">
          Fetching from: {dateRange !== 'all' ? startDate.toISOString().split('T')[0] : 'beginning'}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-red-600">Failed to load Long/Short Ratio data</p>
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
          Long/Short Ratio History: {asset}
        </h2>
        <p className="text-sm text-gray-500">No Long/Short Ratio data available for this asset on {platform}</p>
        <p className="text-xs text-gray-400 mt-2">
          Make sure you've fetched data for {platform}.
        </p>
      </div>
    );
  }

  // Prepare chart data (reverse to show oldest to newest)
  const chartData = [...data]
    .reverse()
    .map((record) => ({
      timestamp: new Date(record.timestamp).getTime(),
      longShortRatio: record.long_short_ratio,
      longAccount: record.long_account,
      shortAccount: record.short_account,
      formattedDate: formatDate(record.timestamp, 'MMM dd HH:mm'),
    }));

  // Calculate statistics
  const latestRatio = chartData[chartData.length - 1]?.longShortRatio || 0;
  const latestLong = chartData[chartData.length - 1]?.longAccount || 0;
  const latestShort = chartData[chartData.length - 1]?.shortAccount || 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Long/Short Ratio History: {asset}
          </h2>
          <div className="flex gap-4 mt-1 text-sm">
            <span className="text-gray-600">
              Ratio: <span className="font-semibold">{formatNumber(latestRatio, 4)}</span>
            </span>
            <span className="text-green-600">
              Longs: <span className="font-semibold">{formatNumber(latestLong * 100, 2)}%</span>
            </span>
            <span className="text-red-600">
              Shorts: <span className="font-semibold">{formatNumber(latestShort * 100, 2)}%</span>
            </span>
          </div>
        </div>

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
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd')}
            />
            <YAxis
              yAxisId="ratio"
              domain={['auto', 'auto']}
              tickFormatter={(value) => formatNumber(value, 2)}
              label={{ value: 'L/S Ratio', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              labelFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd, yyyy HH:mm')}
              formatter={(value: number, name: string) => {
                if (name === 'L/S Ratio') return [formatNumber(value, 4), name];
                if (name === 'Longs') return [formatNumber(value * 100, 2) + '%', name];
                if (name === 'Shorts') return [formatNumber(value * 100, 2) + '%', name];
                return [value, name];
              }}
            />
            <Legend />
            <ReferenceLine y={1} yAxisId="ratio" stroke="#9ca3af" strokeDasharray="3 3" label="1.0" />
            <defs>
              <linearGradient id="colorRatio" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <Area
              yAxisId="ratio"
              type="monotone"
              dataKey="longShortRatio"
              stroke="#8b5cf6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorRatio)"
              name="L/S Ratio"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        Showing {data.length} data points
      </div>
    </div>
  );
}
