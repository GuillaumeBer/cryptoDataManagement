import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useLiquidations } from '../hooks/useApi';
import { formatDate, formatLargeNumber } from '../utils/formatters';

const DATE_RANGE_OPTIONS = ['7d', '14d', '30d', 'all'] as const;
type DateRangeOption = typeof DATE_RANGE_OPTIONS[number];

interface LiquidationChartProps {
  asset: string;
  platform: string;
}

interface AggregatedRecord {
  label: string;
  timestamp: number;
  longVolume: number;
  shortVolume: number;
  totalVolume: number;
}

const formatVolumeTooltip = (value: number) => [`${formatLargeNumber(value)}`, 'Volume'];

export default function LiquidationChart({ asset, platform }: LiquidationChartProps) {
  const [dateRange, setDateRange] = useState<DateRangeOption>('7d');

  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    const start = new Date(end);

    switch (dateRange) {
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '14d':
        start.setDate(start.getDate() - 14);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      default:
        start.setFullYear(start.getFullYear() - 1);
        break;
    }

    return { startDate: start, endDate: end };
  }, [dateRange]);

  const { data, isLoading, error } = useLiquidations({
    asset,
    platform,
    startDate: dateRange !== 'all' ? startDate : undefined,
    endDate,
    limit: 1000,
  });

  const aggregated = useMemo<AggregatedRecord[]>(() => {
    if (!data || data.length === 0) {
      return [];
    }

    const buckets = new Map<string, AggregatedRecord>();

    data.forEach((record) => {
      const key = new Date(record.timestamp).toISOString().split('T')[0];
      const timestamp = new Date(record.timestamp).getTime();
      const existing = buckets.get(key) ?? {
        label: key,
        timestamp,
        longVolume: 0,
        shortVolume: 0,
        totalVolume: 0,
      };

      if (record.side === 'Long') {
        existing.longVolume += record.volume_usd;
      } else {
        existing.shortVolume += record.volume_usd;
      }
      existing.totalVolume += record.volume_usd;
      buckets.set(key, existing);
    });

    return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [data]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading liquidation data for {asset}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-red-600">Failed to load liquidation chart.</p>
        <p className="text-xs text-red-500 mt-2">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  if (aggregated.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Liquidation Volume: {asset}</h2>
        <p className="text-sm text-gray-500">
          No liquidation records found for {asset} on {platform}. Make sure the data fetch completed successfully or try
          selecting Binance or OKX which currently expose liquidation data.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Liquidation Volume: {asset}
          <span className="text-sm font-normal text-gray-500"> ({platform.toUpperCase()})</span>
        </h2>
        <div className="flex gap-2 flex-wrap">
          {DATE_RANGE_OPTIONS.map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                dateRange === range ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range === 'all' ? 'All' : range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={aggregated}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => formatDate(new Date(value), 'MMM dd')}
            />
            <YAxis tickFormatter={(value) => formatLargeNumber(value)} />
            <Tooltip
              labelFormatter={(value) => formatDate(new Date(value), 'MMM dd, yyyy')}
              formatter={(value: number) => formatVolumeTooltip(value)}
            />
            <Legend />
            <Bar dataKey="longVolume" stackId="liquidation" fill="#14b8a6" name="Long Volume" />
            <Bar dataKey="shortVolume" stackId="liquidation" fill="#f97316" name="Short Volume" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        Showing {aggregated.length} daily buckets ({formatDate(new Date(aggregated[0].timestamp), 'MMM dd')} &ndash;{' '}
        {formatDate(new Date(aggregated[aggregated.length - 1].timestamp), 'MMM dd')})
      </div>
    </div>
  );
}
