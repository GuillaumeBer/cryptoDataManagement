import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  Time,
  CandlestickSeriesPartialOptions,
  HistogramSeriesPartialOptions,
} from 'lightweight-charts';
import * as LightweightCharts from 'lightweight-charts';
import { useOHLCV } from '../hooks/useApi';
import type { OHLCVRecord } from '../types';
import { formatDate } from '../utils/formatters';

interface OHLCVChartProps {
  asset: string;
  platform: string;
}

const RANGE_OPTIONS = [
  { id: '24h', label: '24h', hours: 24 },
  { id: '3d', label: '3d', hours: 72 },
  { id: '7d', label: '7d', hours: 7 * 24 },
  { id: '14d', label: '14d', hours: 14 * 24 },
  { id: '20d', label: '20d', hours: 20 * 24 },
  { id: 'all', label: 'All', hours: null },
] as const;

export default function OHLCVChart({ asset, platform }: OHLCVChartProps) {
  const [dateRange, setDateRange] = useState<(typeof RANGE_OPTIONS)[number]['id']>('7d');
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const { data, isLoading, error } = useOHLCV({
    asset,
    platform,
    timeframe: '1h',
    limit: 1500,
  });

  const sortedData = useMemo(() => {
    if (!data) return [] as OHLCVRecord[];
    return [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [data]);

  const filteredData = useMemo(() => {
    if (!sortedData.length) return [] as OHLCVRecord[];
    const selectedRange = RANGE_OPTIONS.find((range) => range.id === dateRange);
    if (!selectedRange || selectedRange.hours === null) {
      return sortedData;
    }

    const cutoff = Date.now() - selectedRange.hours * 60 * 60 * 1000;
    return sortedData.filter((record) => new Date(record.timestamp).getTime() >= cutoff);
  }, [sortedData, dateRange]);

  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) {
      return;
    }

    const chart = LightweightCharts.createChart(chartContainerRef.current, {
      layout: {
        textColor: '#0f172a',
        background: { color: 'transparent' },
      },
      grid: {
        vertLines: { color: '#e2e8f0' },
        horzLines: { color: '#e2e8f0' },
      },
      rightPriceScale: {
        scaleMargins: {
          top: 0.05,
          bottom: 0.2,
        },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      localization: {
        priceFormatter: (price: number) => price.toLocaleString(),
      },
    });

    const extendedChart = chart as IChartApi & {
      addCandlestickSeries?: (
        options?: CandlestickSeriesPartialOptions
      ) => ISeriesApi<'Candlestick'>;
      addHistogramSeries?: (
        options?: HistogramSeriesPartialOptions
      ) => ISeriesApi<'Histogram'>;
    };

    const candleSeriesOptions: CandlestickSeriesPartialOptions = {
      upColor: '#22c55e',
      borderUpColor: '#22c55e',
      wickUpColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      wickDownColor: '#ef4444',
    };

    const candleSeriesDefinition = LightweightCharts.CandlestickSeries;
    if (!extendedChart.addCandlestickSeries && !candleSeriesDefinition) {
      console.error('lightweight-charts build missing CandlestickSeries definition');
      chart.remove();
      return;
    }

    const candleSeries = extendedChart.addCandlestickSeries
      ? extendedChart.addCandlestickSeries(candleSeriesOptions)
      : chart.addSeries(candleSeriesDefinition, candleSeriesOptions);

    const volumeSeriesOptions: HistogramSeriesPartialOptions = {
      color: 'rgba(148, 163, 184, 0.4)',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    };

    const histogramDefinition = LightweightCharts.HistogramSeries;
    if (!extendedChart.addHistogramSeries && !histogramDefinition) {
      console.error('lightweight-charts build missing HistogramSeries definition');
      chart.remove();
      return;
    }

    const volumeSeries = extendedChart.addHistogramSeries
      ? extendedChart.addHistogramSeries(volumeSeriesOptions)
      : chart.addSeries(histogramDefinition, volumeSeriesOptions);

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (!chartContainerRef.current) return;
      const { clientWidth, clientHeight } = chartContainerRef.current;
      chart.applyOptions({ width: clientWidth, height: clientHeight });
      chart.timeScale().fitContent();
    };

    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    if (!filteredData.length) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }

    const candleData: CandlestickData[] = filteredData.map((record) => ({
      time: Math.floor(new Date(record.timestamp).getTime() / 1000) as Time,
      open: record.open,
      high: record.high,
      low: record.low,
      close: record.close,
    }));

    const volumeData: HistogramData[] = filteredData.map((record) => ({
      time: Math.floor(new Date(record.timestamp).getTime() / 1000) as Time,
      value: record.volume ?? 0,
      color: record.close >= record.open ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
  }, [filteredData]);

  const latestCandle = filteredData[filteredData.length - 1];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{asset} Candles</h2>
          <p className="text-sm text-gray-500">
            Data source: {platform} · Timeframe: 1h
          </p>
          {latestCandle && (
            <p className="text-xs text-gray-400 mt-1">
              Last update: {formatDate(latestCandle.timestamp, 'MMM dd, yyyy HH:mm')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {RANGE_OPTIONS.map((range) => (
            <button
              key={range.id}
              onClick={() => setDateRange(range.id)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                dateRange === range.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-96">
        <div ref={chartContainerRef} className="absolute inset-0" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 bg-white/80">
            Loading OHLCV data...
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 bg-white/80">
            Failed to load OHLCV data
          </div>
        )}
        {!isLoading && !error && filteredData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 bg-white/80">
            No OHLCV data available for this asset yet.
          </div>
        )}
      </div>

      {latestCandle && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase">Open</p>
            <p className="text-lg font-semibold text-gray-900">
              {latestCandle.open.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">High</p>
            <p className="text-lg font-semibold text-gray-900">
              {latestCandle.high.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Low</p>
            <p className="text-lg font-semibold text-gray-900">
              {latestCandle.low.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Close</p>
            <p className={`text-lg font-semibold ${
              latestCandle.close >= latestCandle.open ? 'text-green-600' : 'text-red-600'
            }`}>
              {latestCandle.close.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Volume</p>
            <p className="text-lg font-semibold text-gray-900">
              {(latestCandle.volume ?? 0).toLocaleString()}
            </p>
          </div>
          {latestCandle.quote_volume !== null && (
            <div>
              <p className="text-xs text-gray-500 uppercase">Quote Volume</p>
              <p className="text-lg font-semibold text-gray-900">
                {latestCandle.quote_volume.toLocaleString()}
              </p>
            </div>
          )}
          {latestCandle.trades_count !== null && (
            <div>
              <p className="text-xs text-gray-500 uppercase">Trades</p>
              <p className="text-lg font-semibold text-gray-900">
                {latestCandle.trades_count.toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
