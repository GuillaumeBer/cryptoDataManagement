import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProgressStream } from '../hooks/useProgressStream';
import { useToast } from '../hooks/useToast';
import apiClient from '../services/api';
import type { ProgressEvent, ProgressStageSnapshot } from '../types';

interface DataFetcherProps {
  platform: string;
  selectedAsset?: string | null;
}

export default function DataFetcher({ platform, selectedAsset }: DataFetcherProps) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const { progress, status: streamStatus, error: streamError, currentType, start, stop, hydrateProgress } =
    useProgressStream(platform);

  const isFetching = streamStatus === 'connecting' || streamStatus === 'connected' || streamStatus === 'reconnecting';
  const activeFetchType = currentType;

  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['status', platform] });
    queryClient.invalidateQueries({ queryKey: ['assets', platform] });
    queryClient.invalidateQueries({ queryKey: ['funding-history'] });
    queryClient.invalidateQueries({ queryKey: ['ohlcv'] });
    queryClient.invalidateQueries({ queryKey: ['open-interest'] });
    queryClient.invalidateQueries({ queryKey: ['long-short-ratios'] });
    queryClient.invalidateQueries({ queryKey: ['liquidations'] });
    if (selectedAsset) {
      queryClient.invalidateQueries({ queryKey: ['analytics', selectedAsset, platform] });
    }
  }, [queryClient, platform, selectedAsset]);

  const lastTerminalEventRef = useRef<string | null>(null);
  const lastStreamErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!progress) {
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
      const errors = progress.errors ?? [];
      const key = `error-${errors.join('-')}`;
      if (lastTerminalEventRef.current === key) return;
      lastTerminalEventRef.current = key;
      addToast(errors[0] ?? 'Fetch failed', 'error');
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
    hydrateProgress(null);

    const checkOngoingFetch = async () => {
      try {
        const status = await apiClient.getStatus(platform);
        const fetchState = status.fetchInProgress;
        if (fetchState?.isInitialFetchInProgress || fetchState?.isIncrementalFetchInProgress) {
          const type = fetchState.isInitialFetchInProgress ? 'initial' : 'incremental';
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
      hydrateProgress(null);
      addToast(`Starting ${type} fetch on ${platform}`, 'info');
      start(type);
    } catch (error) {
      addToast('Unable to determine fetch type. Starting initial fetch.', 'error');
      hydrateProgress(null);
      start('initial');
    }
  };

  const formatStageStatus = (status: ProgressStageSnapshot['status']) => {
    switch (status) {
      case 'active':
        return 'In progress';
      case 'complete':
        return 'Completed';
      default:
        return 'Pending';
    }
  };

  const getStageBarColor = (stage: ProgressStageSnapshot) => {
    if (stage.status === 'complete') {
      return 'bg-green-500';
    }
    if (stage.status === 'active') {
      return 'bg-blue-600';
    }
    return 'bg-gray-300';
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
          {((current.errors?.length ?? 0) > 0) && (
            <p className="text-xs text-red-600 mt-1">{current.errors?.[0]}</p>
          )}
        </div>
      );
    }

    if (current && current.phase === 'resample' && current.type !== 'complete') {
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
          {(current.errors?.length ?? 0) > 0 && (
            <p className="text-xs text-orange-600 mt-1">{current.errors?.length} errors occurred</p>
          )}
          {current.phase === 'resample' && (
            <p className="text-xs text-gray-600 mt-1">Hyperliquid data is ready for 8-hour comparisons.</p>
          )}
        </div>
      );
    }

    if (current) {
      const stageDetails = current.stages ?? [];
      const activeStage =
        stageDetails.find((stage) => stage.status === 'active') ??
        (stageDetails.length > 0 ? stageDetails[stageDetails.length - 1] : undefined);
      const summaryMessage =
        current.message ??
        (activeStage?.message ??
          (activeStage ? `${activeStage.label} (${formatStageStatus(activeStage.status)})` : 'Processing data'));

      return (
        <div className="mt-3 space-y-3">
          <div className="p-3 bg-blue-50 border border-blue-100 rounded">
            <div className="flex items-center justify-between text-sm text-blue-900 font-medium">
              <span>{summaryMessage}</span>
              <span>{current.percentage}%</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2 mt-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${current.percentage}%` }}
              />
            </div>
            <div className="text-xs text-blue-900 mt-2 flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Assets processed: {current.processedAssets} / {current.totalAssets}
              </span>
              <span>Funding records: {current.recordsFetched}</span>
              {typeof current.liquidationRecordsFetched === 'number' && (
                <span>Liquidation records: {current.liquidationRecordsFetched}</span>
              )}
              {typeof current.ohlcvRecordsFetched === 'number' && (
                <span>OHLCV records: {current.ohlcvRecordsFetched}</span>
              )}
            </div>
            {current.currentAsset && (
              <p className="text-xs text-blue-800 mt-1 truncate">Current asset: {current.currentAsset}</p>
            )}
          </div>

          {stageDetails.length > 0 && (
            <div className="space-y-2">
              {stageDetails.map((stage) => (
                <div key={stage.key} className="border border-gray-200 rounded-lg p-2">
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span className="font-medium text-gray-800">{stage.label}</span>
                    <span>{stage.percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                    <div
                      className={`${getStageBarColor(stage)} h-1.5 rounded-full transition-all duration-300`}
                      style={{ width: `${stage.percentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1">
                    <span>{formatStageStatus(stage.status)}</span>
                    <span>
                      {stage.completed}/{stage.total}
                    </span>
                  </div>
                  {stage.status === 'active' && stage.currentItem && (
                    <p className="text-[11px] text-gray-500 mt-1 truncate">Current: {stage.currentItem}</p>
                  )}
                </div>
              ))}
            </div>
          )}
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
