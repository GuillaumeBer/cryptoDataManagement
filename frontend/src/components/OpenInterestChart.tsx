import { useState, useMemo } from 'react';
import { useOpenInterestData } from '../hooks/useApi';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts';
import { formatDate, formatLargeNumber } from '../utils/formatters';

interface OpenInterestChartProps {
  asset: string;
  platform: string;
}

export default function OpenInterestChart({ asset, platform }: OpenInterestChartProps) {
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

  const { data, isLoading, error } = useOpenInterestData({
    asset,
    platform,
    startDate: dateRange !== 'all' ? startDate : undefined,
    endDate,
    timeframe: '1h',
    limit: 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading Open Interest data for {asset}...</p>
        <p className="text-xs text-gray-400 mt-2">
          Fetching from: {dateRange !== 'all' ? startDate.toISOString().split('T')[0] : 'beginning'}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-red-600">Failed to load Open Interest data</p>
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
          Open Interest History: {asset}
        </h2>
        <p className="text-sm text-gray-500">No Open Interest data available for this asset on {platform}</p>
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
      openInterest: record.open_interest,
      openInterestValue: record.open_interest_value,
      formattedDate: formatDate(record.timestamp, 'MMM dd HH:mm'),
    }));

  // Check if we have USD value data
  const hasValueData = chartData.some(d => d.openInterestValue !== null && d.openInterestValue !== undefined);

  // Calculate statistics
  const latestOI = chartData[chartData.length - 1]?.openInterest || 0;
  const firstOI = chartData[0]?.openInterest || 0;
  const oiChange = latestOI - firstOI;
  const oiChangePercent = firstOI !== 0 ? (oiChange / firstOI) * 100 : 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Open Interest History: {asset}
          </h2>
          <div className="flex gap-4 mt-1 text-sm">
            <span className="text-gray-600">
              Current: <span className="font-semibold">{formatLargeNumber(latestOI)}</span> contracts
            </span>
            <span className={oiChange >= 0 ? 'text-green-600' : 'text-red-600'}>
              {oiChange >= 0 ? '+' : ''}{formatLargeNumber(oiChange)} ({oiChangePercent.toFixed(2)}%)
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
          {hasValueData ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd')}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={(value) => formatLargeNumber(value)}
                label={{ value: 'Contracts', angle: -90, position: 'insideLeft' }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(value) => `$${formatLargeNumber(value)}`}
                label={{ value: 'Value (USD)', angle: 90, position: 'insideRight' }}
              />
              <Tooltip
                labelFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd, yyyy HH:mm')}
                formatter={(value: number, name: string) => {
                  if (name === 'Open Interest') {
                    return [formatLargeNumber(value) + ' contracts', name];
                  }
                  return ['$' + formatLargeNumber(value), name];
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="openInterest"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                name="Open Interest"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="openInterestValue"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
                name="OI Value (USD)"
              />
            </LineChart>
          ) : (
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd')}
              />
              <YAxis
                tickFormatter={(value) => formatLargeNumber(value)}
                label={{ value: 'Open Interest (Contracts)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                labelFormatter={(timestamp) => formatDate(new Date(timestamp), 'MMM dd, yyyy HH:mm')}
                formatter={(value: number) => [formatLargeNumber(value) + ' contracts', 'Open Interest']}
              />
              <Legend />
              <defs>
                <linearGradient id="colorOI" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="openInterest"
                stroke="#2563eb"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorOI)"
                name="Open Interest"
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        Showing {data.length} data points
      </div>
    </div>
  );
}
