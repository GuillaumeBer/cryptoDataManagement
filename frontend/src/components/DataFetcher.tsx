import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProgressStream } from '../hooks/useProgressStream';
import { useToast } from '../hooks/useToast';
import apiClient from '../services/api';
import type { ProgressEvent } from '../types';

interface DataFetcherProps {
  platform: string;
  selectedAsset?: string | null;
}

const STREAMING_STATUSES = new Set(['connecting', 'connected', 'reconnecting']);

export default function DataFetcher({ platform, selectedAsset }: DataFetcherProps) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [fetchType, setFetchType] = useState<'initial' | 'incremental'>('initial');

  const { progress, status: streamStatus, error: streamError, currentType, start, stop, hydrateProgress } =
    useProgressStream(platform);

  const lastTerminalEventRef = useRef<string | null>(null);
  const lastStreamErrorRef = useRef<string | null>(null);

  const isFetching = useMemo(() => STREAMING_STATUSES.has(streamStatus), [streamStatus]);
  const activeFetchType = currentType ?? fetchType;

  const invalidateQueries = useCallback(() => {
    const invalidations: Promise<unknown>[] = [
      queryClient.invalidateQueries({ queryKey: ['status', platform] }),
      queryClient.invalidateQueries({ queryKey: ['assets', platform] }),
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'logs',
      }),
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'funding-rates',
      }),
    ];

    if (selectedAsset) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['analytics', selectedAsset, platform] }));
    }

    return Promise.all(invalidations);
  }, [platform, queryClient, selectedAsset]);

  useEffect(() => {
    if (!progress) {
      lastTerminalEventRef.current = null;
      return;
    }

    if (progress.type === 'complete') {
      const resampleKey = `${progress.resampleRecordsCreated ?? 0}-${progress.resampleAssetsProcessed ?? 0}`;
      const key = `complete-${progress.phase}-${progress.recordsFetched}-${progress.processedAssets}-${resampleKey}`;
      if (lastTerminalEventRef.current === key) return;
      lastTerminalEventRef.current = key;
      addToast(
        progress.phase === 'resample' ? 'Data fetch & resampling completed' : 'Data fetch completed',
        'success'
      );
      invalidateQueries();
    } else if (progress.type === 'error') {
      const key = `error-${progress.errors.join('-')}`;
      if (lastTerminalEventRef.current === key) return;
      lastTerminalEventRef.current = key;
      addToast(progress.errors[0] ?? 'Fetch failed', 'error');
      invalidateQueries();
    }
  }, [progress, addToast, invalidateQueries]);

  useEffect(() => {
    if (!streamError) {
      lastStreamErrorRef.current = null;
      return;
    }

    if (lastStreamErrorRef.current === streamError) return;
    lastStreamErrorRef.current = streamError;
    addToast(streamError, 'error');
  }, [streamError, addToast]);

  useEffect(() => {
    stop();
    setFetchType('initial');
    hydrateProgress(null);

    const checkOngoingFetch = async () => {
      try {
        const status = await apiClient.getStatus(platform);
        const fetchState = status.fetchInProgress;
        if (fetchState?.isInitialFetchInProgress || fetchState?.isIncrementalFetchInProgress) {
          const type = fetchState.isInitialFetchInProgress ? 'initial' : 'incremental';
          setFetchType(type);
          if (fetchState.currentProgress) {
            hydrateProgress(fetchState.currentProgress);
          }
          addToast(`Reconnected to ${type} fetch on ${platform}`, 'info');
          start(type);
        }
      } catch (error) {
        addToast('Unable to check ongoing fetch status.', 'error');
      }
    };

    checkOngoingFetch();
  }, [platform, stop, hydrateProgress, start, addToast]);

  const handleFetch = async () => {
    try {
      const status = await apiClient.getStatus(platform);
      const hasData = status?.fundingRateCount > 0;
      const type: 'initial' | 'incremental' = hasData ? 'incremental' : 'initial';
      setFetchType(type);
      hydrateProgress(null);
      addToast(`Starting ${type} fetch on ${platform}`, 'info');
      start(type);
    } catch (error) {
      addToast('Unable to determine fetch type. Starting initial fetch.', 'error');
      setFetchType('initial');
      hydrateProgress(null);
      start('initial');
    }
  };

  const renderProgress = (current: ProgressEvent | null, fetching: boolean) => {
    if (!current && !fetching && !streamError) return null;

    if (fetching && !current) {
      return (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">Initializing...</p>
        </div>
      );
    }

    if (streamError && !current) {
      return (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">{streamError}</p>
        </div>
      );
    }

    if (current?.type === 'error') {
      return (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">✗ Failed to fetch data</p>
          {current.errors.length > 0 && (
            <p className="text-xs text-red-600 mt-1">{current.errors[0]}</p>
          )}
        </div>
      );
    }

    if (current?.phase === 'resample' && current.type !== 'error' && current.type !== 'complete') {
      return (
        <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded">
          <p className="text-sm text-purple-800">{current.message ?? 'Generating 8-hour aggregated data...'}</p>
          <p className="text-xs text-purple-600 mt-1">This may take a few moments.</p>
        </div>
      );
    }

    if (current?.type === 'complete') {
      return (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-sm text-green-800">
            {current.phase === 'resample'
              ? `✓ Completed! ${current.resampleRecordsCreated ?? 0} aggregated records generated across ${current.resampleAssetsProcessed ?? 0} assets`
              : `✓ Completed! Fetched ${current.recordsFetched} records from ${current.processedAssets} assets`}
          </p>
          {current.errors.length > 0 && (
            <p className="text-xs text-orange-600 mt-1">{current.errors.length} errors occurred</p>
          )}
          {current.phase === 'resample' && (
            <p className="text-xs text-gray-600 mt-1">Hyperliquid data is ready for 8-hour comparisons.</p>
          )}
        </div>
      );
    }

    if (current) {
      return (
        <div className="mt-3 space-y-2">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${current.percentage}%` }} />
          </div>

          <div className="text-sm text-gray-700">
            <p className="font-medium">
              Processing: {current.processedAssets} / {current.totalAssets} assets ({current.percentage}%)
            </p>
            {current.currentAsset && (
              <p className="text-xs text-gray-500 mt-1">Current: {current.currentAsset}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">Records fetched: {current.recordsFetched}</p>
          </div>
        </div>
      );
    }

    return null;
  };

  const getButtonText = () => {
    if (isFetching) {
      return activeFetchType === 'initial' ? 'Fetching all data...' : 'Updating data...';
    }
    return 'Fetch Data';
  };

  const getDescription = () => {
    if (platform === 'hyperliquid') {
      return 'Fetch funding rate data (480 hours) and automatically generate 8-hour aggregated data for comparison';
    }
    return 'Fetch funding rate data for the last 480 hours';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Management</h2>

      <div className="border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-2">Fetch Data</h3>
        <p className="text-sm text-gray-600 mb-4">{getDescription()}</p>
        <button
          onClick={handleFetch}
          disabled={isFetching}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {getButtonText()}
        </button>

        {renderProgress(progress, isFetching)}
      </div>
    </div>
  );
}
