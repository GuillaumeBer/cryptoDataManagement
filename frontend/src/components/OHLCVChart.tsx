import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Brush,
  Customized,
  ReferenceLine,
  type TooltipProps,
} from 'recharts';
import { formatDate, formatLargeNumber, formatNumber } from '../utils/formatters';
import { useOHLCVData } from '../hooks/useApi';

const LOOKBACK_OPTIONS = [
  { id: '3d', label: '3D', days: 3 },
  { id: '7d', label: '7D', days: 7 },
  { id: '14d', label: '14D', days: 14 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: 'max', label: 'Max', days: null },
] as const;

const TIMEFRAME_OPTIONS = [
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
] as const;

const TIME_AXIS_ID = 'time-axis';
const PRICE_AXIS_ID = 'price-axis';
const VOLUME_AXIS_ID = 'volume-axis';

type LookbackId = (typeof LOOKBACK_OPTIONS)[number]['id'];
type TimeframeId = (typeof TIMEFRAME_OPTIONS)[number]['id'];

interface ChartCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  iso: string;
}

interface OHLCVChartProps {
  asset: string;
  platform: string;
}

type AxisMapEntry = {
  scale?: (value: number) => number;
};

type AxisMap = Record<string | number, AxisMapEntry>;

interface CustomizedLayerProps {
  xAxisMap?: AxisMap;
  yAxisMap?: AxisMap;
}

const CandlestickLayer = ({ data, width = 8 }: { data: ChartCandle[]; width?: number }) => (
  <Customized
    component={(props: CustomizedLayerProps) => {
      const xAxisMap = props.xAxisMap ?? {};
      const yAxisMap = props.yAxisMap ?? {};
      const xAxis =
        xAxisMap[TIME_AXIS_ID] ?? Object.values(xAxisMap)[0];
      const yAxis =
        yAxisMap[PRICE_AXIS_ID] ?? Object.values(yAxisMap)[0];

      if (!xAxis?.scale || !yAxis?.scale) {
        return null;
      }

      return (
        <g>
          {data.map((candle) => {
            const x = xAxis.scale!(candle.timestamp);
            const highY = yAxis.scale!(candle.high);
            const lowY = yAxis.scale!(candle.low);
            const openY = yAxis.scale!(candle.open);
            const closeY = yAxis.scale!(candle.close);
            const color = candle.close >= candle.open ? '#16a34a' : '#dc2626';
            const rectY = Math.min(openY, closeY);
            const rectHeight = Math.max(Math.abs(closeY - openY), 1);

            return (
              <g key={candle.timestamp}>
                <line
                  x1={x}
                  x2={x}
                  y1={highY}
                  y2={lowY}
                  stroke={color}
                  strokeWidth={1}
                />
                <rect
                  x={x - width / 2}
                  width={width}
                  y={rectY}
                  height={rectHeight}
                  fill={color}
                  stroke={color}
                  rx={1}
                />
              </g>
            );
          })}
        </g>
      );
    }}
  />
);

const CandleTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const candle = payload[0]?.payload as ChartCandle | undefined;
  if (!candle) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg text-xs">
      <p className="font-semibold text-gray-900 mb-1">{formatDate(candle.iso, 'PPpp')}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
        <span>Open</span>
        <span className="text-right font-medium text-gray-900">{formatNumber(candle.open, 4)}</span>
        <span>High</span>
        <span className="text-right font-medium text-gray-900">{formatNumber(candle.high, 4)}</span>
        <span>Low</span>
        <span className="text-right font-medium text-gray-900">{formatNumber(candle.low, 4)}</span>
        <span>Close</span>
        <span className="text-right font-medium text-gray-900">{formatNumber(candle.close, 4)}</span>
        <span>Volume</span>
        <span className="text-right font-medium text-gray-900">
          {formatLargeNumber(candle.volume)}
        </span>
      </div>
    </div>
  );
};

export default function OHLCVChart({ asset, platform }: OHLCVChartProps) {
  const [range, setRange] = useState<LookbackId>('14d');
  const [timeframe, setTimeframe] = useState<TimeframeId>('1h');

  const { startDate, endDate, selectedLabel } = useMemo(() => {
    const end = new Date();
    const selected = LOOKBACK_OPTIONS.find((opt) => opt.id === range);
    if (!selected?.days) {
      return { startDate: undefined, endDate: end, selectedLabel: 'entire history' };
    }
    const start = new Date(end);
    start.setDate(start.getDate() - selected.days);
    return { startDate: start, endDate: end, selectedLabel: selected.label };
  }, [range]);

  const { data, isLoading, error, isFetching } = useOHLCVData({
    asset,
    platform,
    timeframe,
    startDate,
    endDate,
    limit: 1000,
  });

  const chartData: ChartCandle[] = useMemo(() => {
    if (!data) return [];
    return [...data]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((entry) => ({
        timestamp: new Date(entry.timestamp).getTime(),
        iso: entry.timestamp,
        open: Number(entry.open),
        high: Number(entry.high),
        low: Number(entry.low),
        close: Number(entry.close),
        volume: Number(entry.volume ?? 0),
      }));
  }, [data]);

  const [minPrice, maxPrice] = useMemo(() => {
    if (!chartData.length) return [0, 0];
    const lows = chartData.map((c) => c.low);
    const highs = chartData.map((c) => c.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    return [min, max];
  }, [chartData]);

  const pricePadding = (maxPrice - minPrice || 1) * 0.05;
  const priceDomain: [number, number] = [
    minPrice - pricePadding,
    maxPrice + pricePadding,
  ];

  const maxVolume = useMemo(() => {
    if (!chartData.length) return 0;
    return Math.max(...chartData.map((c) => c.volume));
  }, [chartData]);

  const latestCandle = chartData[chartData.length - 1];
  const firstCandle = chartData[0];
  const priceChange =
    latestCandle && firstCandle
      ? ((latestCandle.close - firstCandle.close) / firstCandle.close) * 100
      : 0;

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
          <p className="text-sm text-gray-600">
            Loading OHLCV candles for {asset} on {platform}…
          </p>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Timeframe: {timeframe.toUpperCase()} | Range:{' '}
          {selectedLabel}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <p className="text-sm text-red-600">Failed to load OHLCV data.</p>
        {error && (
          <p className="text-xs text-red-500 mt-2">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-dashed border-gray-200 p-6 text-center">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          No OHLCV history yet
        </h3>
        <p className="text-sm text-gray-500">
          Fetch candlestick data for {asset} on {platform} to populate this view.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Selected timeframe: {timeframe.toUpperCase()} · Range: {selectedLabel}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-indigo-600 font-semibold">
            <span className="h-1 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-400" />
            OHLCV
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            {asset} Candles <span className="text-sm font-normal text-gray-500">({timeframe.toUpperCase()})</span>
          </h2>
          {latestCandle && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600">
              <span>
                Last close:{' '}
                <span className="font-semibold text-gray-900">
                  {formatNumber(latestCandle.close, 4)}
                </span>
              </span>
              <span className={priceChange >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                {priceChange >= 0 ? '+' : ''}
                {priceChange.toFixed(2)}%
              </span>
              <span className="text-gray-400 text-xs">
                Updated {formatDate(latestCandle.iso, 'PPpp')}
              </span>
              {isFetching && <span className="text-xs text-blue-500">Refreshing…</span>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex bg-gray-100 rounded-full p-1 text-xs font-medium text-gray-600">
            {LOOKBACK_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setRange(option.id)}
                className={`px-3 py-1 rounded-full transition ${
                  range === option.id ? 'bg-white shadow text-gray-900' : 'hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value as TimeframeId)}
            className="rounded-full border border-gray-200 px-4 py-1 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {TIMEFRAME_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => formatDate(new Date(value as number), 'MMM dd')}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
              xAxisId={TIME_AXIS_ID}
            />
            <YAxis
              yAxisId={PRICE_AXIS_ID}
              domain={priceDomain}
              tickFormatter={(value) => formatNumber(value, 2)}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
              width={80}
            />
            <YAxis
              yAxisId={VOLUME_AXIS_ID}
              orientation="right"
              domain={[0, maxVolume ? maxVolume * 1.2 : 'dataMax']}
              tickFormatter={(value) => formatLargeNumber(value)}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<CandleTooltip />} />
            <Legend />
            {latestCandle && (
              <ReferenceLine
                yAxisId={PRICE_AXIS_ID}
                xAxisId={TIME_AXIS_ID}
                y={latestCandle.close}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                label={{
                  value: `Last ${formatNumber(latestCandle.close, 4)}`,
                  position: 'right',
                  fill: '#475569',
                }}
              />
            )}
            <Bar
              dataKey="volume"
              barSize={6}
              fill="#c7d2fe"
              opacity={0.9}
              xAxisId={TIME_AXIS_ID}
              yAxisId={VOLUME_AXIS_ID}
              name="Volume"
            />
            <CandlestickLayer data={chartData} width={10} />
            <Brush
              dataKey="timestamp"
              height={24}
              travellerWidth={12}
              stroke="#6366f1"
              tickFormatter={(value) => formatDate(new Date(value as number), 'MMM dd')}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span>
          Showing {chartData.length} candles · Range:{' '}
          {selectedLabel}
        </span>
        <span>
          Timeframe: {timeframe.toUpperCase()} · Platform: {platform}
        </span>
      </div>
    </div>
  );
}
