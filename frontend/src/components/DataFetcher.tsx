import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface ProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  totalAssets: number;
  processedAssets: number;
  currentAsset?: string;
  recordsFetched: number;
  errors: string[];
  percentage: number;
}

interface DataFetcherProps {
  platform: string;
}

export default function DataFetcher({ platform }: DataFetcherProps) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [fetching, setFetching] = useState(false);
  const [resampling, setResampling] = useState(false);
  const [fetchType, setFetchType] = useState<'initial' | 'incremental'>('initial');
  const eventSourceRef = useRef<EventSource | null>(null);

  // Reset state and check for ongoing fetches when platform changes
  useEffect(() => {
    console.log(`[FRONTEND] Platform changed to: ${platform}, resetting state`);

    // Close any existing connections from previous platform
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Reset all state
    setProgress(null);
    setFetching(false);
    setResampling(false);

    // After reset, check for ongoing fetches on the new platform
    const checkOngoingFetch = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const response = await fetch(`${apiUrl}/status?platform=${platform}`);
        const statusResponse = await response.json();

        console.log(`[FRONTEND] Status check for ${platform}:`, statusResponse);

        // Extract the actual status data from the API response wrapper
        const status = statusResponse.data;

        // Reconnect to ongoing fetch for this platform (either initial or incremental)
        if (status?.fetchInProgress?.isInitialFetchInProgress || status?.fetchInProgress?.isIncrementalFetchInProgress) {
          const type = status.fetchInProgress.isInitialFetchInProgress ? 'initial' : 'incremental';
          console.log(`[FRONTEND] Detected ongoing ${type} fetch for ${platform}, reconnecting...`);
          if (status.fetchInProgress.currentProgress) {
            setProgress(status.fetchInProgress.currentProgress);
          }
          setFetchType(type);
          connectToFetch(type);
        }
      } catch (error) {
        console.error('[FRONTEND] Failed to check status:', error);
      }
    };

    checkOngoingFetch();
  }, [platform]);

  // Connect to fetch SSE stream (either initial or incremental)
  const connectToFetch = (type: 'initial' | 'incremental') => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setFetching(true);
    setFetchType(type);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    const endpoint = type === 'initial' ? 'fetch/stream' : 'fetch/incremental/stream';
    console.log('[FRONTEND] Opening EventSource:', `${apiUrl}/${endpoint}?platform=${platform}`);
    const eventSource = new EventSource(`${apiUrl}/${endpoint}?platform=${platform}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[FRONTEND] EventSource connection opened');
    };

    eventSource.onmessage = async (event) => {
      console.log('[FRONTEND] Received message:', event.data);
      const data = JSON.parse(event.data);
      console.log('[FRONTEND] Parsed data:', data);

      // Ignore connection confirmation events
      if (data.type === 'connected' || data.type === 'done') {
        console.log('[FRONTEND] Ignoring event type:', data.type);
        if (data.type === 'done') {
          eventSource.close();
          setFetching(false);
          // Invalidate all data queries to refresh UI with new data
          queryClient.invalidateQueries({ queryKey: ['status'] });
          queryClient.invalidateQueries({ queryKey: ['assets'] });
          queryClient.invalidateQueries({ queryKey: ['analytics'] });
          queryClient.invalidateQueries({ queryKey: ['fundingRates'] });
        }
        return;
      }

      console.log('[FRONTEND] Setting progress:', data);
      setProgress(data as ProgressEvent);

      if (data.type === 'complete') {
        eventSource.close();
        setFetching(false);

        // Invalidate all data queries to refresh UI with new data
        queryClient.invalidateQueries({ queryKey: ['status'] });
        queryClient.invalidateQueries({ queryKey: ['assets'] });
        queryClient.invalidateQueries({ queryKey: ['analytics'] });
        queryClient.invalidateQueries({ queryKey: ['fundingRates'] });

        // Automatically resample for Hyperliquid after successful fetch
        if (platform === 'hyperliquid') {
          console.log('[FRONTEND] Auto-resampling Hyperliquid data to 8h...');
          await performResample();
        }
      } else if (data.type === 'error') {
        eventSource.close();
        setFetching(false);
        // Still invalidate queries even on error to show updated status
        queryClient.invalidateQueries({ queryKey: ['status'] });
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setFetching(false);
      setProgress({
        type: 'error',
        totalAssets: 0,
        processedAssets: 0,
        recordsFetched: 0,
        errors: ['Connection error'],
        percentage: 0,
      });
    };
  };

  // Perform resampling for Hyperliquid
  const performResample = async () => {
    setResampling(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const response = await fetch(`${apiUrl}/resample/hyperliquid-8h`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      console.log('[FRONTEND] Resampling result:', result);

      // Update progress to show resampling success
      if (result.success && progress) {
        setProgress({
          ...progress,
          type: 'complete',
        });
      }

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['status'] });
    } catch (error) {
      console.error('[FRONTEND] Resampling failed:', error);
    } finally {
      setResampling(false);
    }
  };

  // Cleanup event sources on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Smart fetch handler - determines whether to do initial or incremental fetch
  const handleFetch = async () => {
    try {
      // Check if platform has existing data
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const response = await fetch(`${apiUrl}/status?platform=${platform}`);
      const statusResponse = await response.json();
      const status = statusResponse.data;

      // Determine fetch type based on whether data exists
      const hasData = status?.fundingRateCount > 0;
      const type: 'initial' | 'incremental' = hasData ? 'incremental' : 'initial';

      console.log(`[FRONTEND] Platform ${platform} has ${status?.fundingRateCount} records, using ${type} fetch`);

      // Clear progress before starting new fetch
      setProgress(null);
      connectToFetch(type);
    } catch (error) {
      console.error('[FRONTEND] Failed to determine fetch type:', error);
      // Default to initial fetch on error
      setProgress(null);
      connectToFetch('initial');
    }
  };

  const renderProgress = (progress: ProgressEvent | null, isFetching: boolean, isResampling: boolean) => {
    if (!progress && !isFetching) return null;

    if (isFetching && !progress) {
      return (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">Initializing...</p>
        </div>
      );
    }

    if (progress?.type === 'error') {
      return (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">✗ Failed to fetch data</p>
          {progress.errors.length > 0 && (
            <p className="text-xs text-red-600 mt-1">{progress.errors[0]}</p>
          )}
        </div>
      );
    }

    if (progress?.type === 'complete') {
      return (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-sm text-green-800">
            ✓ Completed! Fetched {progress.recordsFetched} records from{' '}
            {progress.processedAssets} assets
          </p>
          {progress.errors.length > 0 && (
            <p className="text-xs text-orange-600 mt-1">
              {progress.errors.length} errors occurred
            </p>
          )}
          {isResampling && platform === 'hyperliquid' && (
            <p className="text-xs text-purple-600 mt-1">
              Generating 8-hour aggregated data...
            </p>
          )}
        </div>
      );
    }

    if (progress) {
      return (
        <div className="mt-3 space-y-2">
          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>

          {/* Progress Text */}
          <div className="text-sm text-gray-700">
            <p className="font-medium">
              Processing: {progress.processedAssets} / {progress.totalAssets} assets ({progress.percentage}%)
            </p>
            {progress.currentAsset && (
              <p className="text-xs text-gray-500 mt-1">
                Current: {progress.currentAsset}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Records fetched: {progress.recordsFetched}
            </p>
          </div>
        </div>
      );
    }

    return null;
  };

  const getButtonText = () => {
    if (fetching) {
      return fetchType === 'initial' ? 'Fetching all data...' : 'Updating data...';
    }
    if (resampling) {
      return 'Resampling...';
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
        <p className="text-sm text-gray-600 mb-4">
          {getDescription()}
        </p>
        <button
          onClick={handleFetch}
          disabled={fetching || resampling}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {getButtonText()}
        </button>

        {renderProgress(progress, fetching, resampling)}
      </div>
    </div>
  );
}
