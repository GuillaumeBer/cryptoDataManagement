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

export default function DataFetcher() {
  const queryClient = useQueryClient();
  const [initialProgress, setInitialProgress] = useState<ProgressEvent | null>(null);
  const [incrementalProgress, setIncrementalProgress] = useState<ProgressEvent | null>(null);
  const [initialFetching, setInitialFetching] = useState(false);
  const [incrementalFetching, setIncrementalFetching] = useState(false);
  const initialEventSourceRef = useRef<EventSource | null>(null);
  const incrementalEventSourceRef = useRef<EventSource | null>(null);

  // Connect to initial fetch SSE stream
  const connectToInitialFetch = () => {
    if (initialEventSourceRef.current) {
      initialEventSourceRef.current.close();
    }

    setInitialFetching(true);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    console.log('[FRONTEND] Opening EventSource:', `${apiUrl}/fetch/stream`);
    const eventSource = new EventSource(`${apiUrl}/fetch/stream`);
    initialEventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[FRONTEND] EventSource connection opened');
    };

    eventSource.onmessage = (event) => {
      console.log('[FRONTEND] Received message:', event.data);
      const data = JSON.parse(event.data);
      console.log('[FRONTEND] Parsed data:', data);

      // Ignore connection confirmation events
      if (data.type === 'connected' || data.type === 'done') {
        console.log('[FRONTEND] Ignoring event type:', data.type);
        if (data.type === 'done') {
          eventSource.close();
          setInitialFetching(false);
          queryClient.invalidateQueries({ queryKey: ['status'] });
          queryClient.invalidateQueries({ queryKey: ['assets'] });
        }
        return;
      }

      console.log('[FRONTEND] Setting progress:', data);
      setInitialProgress(data as ProgressEvent);

      if (data.type === 'complete' || data.type === 'error') {
        eventSource.close();
        setInitialFetching(false);
        queryClient.invalidateQueries({ queryKey: ['status'] });
        queryClient.invalidateQueries({ queryKey: ['assets'] });
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setInitialFetching(false);
      setInitialProgress({
        type: 'error',
        totalAssets: 0,
        processedAssets: 0,
        recordsFetched: 0,
        errors: ['Connection error'],
        percentage: 0,
      });
    };
  };

  // Connect to incremental fetch SSE stream
  const connectToIncrementalFetch = () => {
    if (incrementalEventSourceRef.current) {
      incrementalEventSourceRef.current.close();
    }

    setIncrementalFetching(true);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    const eventSource = new EventSource(`${apiUrl}/fetch/incremental/stream`);
    incrementalEventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Ignore connection confirmation events
      if (data.type === 'connected' || data.type === 'done') {
        if (data.type === 'done') {
          eventSource.close();
          setIncrementalFetching(false);
          queryClient.invalidateQueries({ queryKey: ['status'] });
          queryClient.invalidateQueries({ queryKey: ['assets'] });
        }
        return;
      }

      setIncrementalProgress(data as ProgressEvent);

      if (data.type === 'complete' || data.type === 'error') {
        eventSource.close();
        setIncrementalFetching(false);
        queryClient.invalidateQueries({ queryKey: ['status'] });
        queryClient.invalidateQueries({ queryKey: ['assets'] });
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIncrementalFetching(false);
      setIncrementalProgress({
        type: 'error',
        totalAssets: 0,
        processedAssets: 0,
        recordsFetched: 0,
        errors: ['Connection error'],
        percentage: 0,
      });
    };
  };

  // Check for ongoing fetches on component mount
  useEffect(() => {
    const checkOngoingFetch = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const response = await fetch(`${apiUrl}/status`);
        const status = await response.json();

        console.log('[FRONTEND] Status check:', status);

        // Reconnect to ongoing initial fetch
        if (status.fetchInProgress?.isInitialFetchInProgress) {
          console.log('[FRONTEND] Detected ongoing initial fetch, reconnecting...');
          if (status.fetchInProgress.currentProgress) {
            setInitialProgress(status.fetchInProgress.currentProgress);
          }
          connectToInitialFetch();
        }

        // Reconnect to ongoing incremental fetch
        if (status.fetchInProgress?.isIncrementalFetchInProgress) {
          console.log('[FRONTEND] Detected ongoing incremental fetch, reconnecting...');
          if (status.fetchInProgress.currentProgress) {
            setIncrementalProgress(status.fetchInProgress.currentProgress);
          }
          connectToIncrementalFetch();
        }
      } catch (error) {
        console.error('[FRONTEND] Failed to check status:', error);
      }
    };

    checkOngoingFetch();
  }, []); // Only run on mount

  // Cleanup event sources on unmount
  useEffect(() => {
    return () => {
      if (initialEventSourceRef.current) {
        initialEventSourceRef.current.close();
      }
      if (incrementalEventSourceRef.current) {
        incrementalEventSourceRef.current.close();
      }
    };
  }, []);

  const handleInitialFetch = () => {
    // Clear progress before starting new fetch
    setInitialProgress(null);
    connectToInitialFetch();
  };

  const handleIncrementalFetch = () => {
    // Clear progress before starting new fetch
    setIncrementalProgress(null);
    connectToIncrementalFetch();
  };

  const renderProgress = (progress: ProgressEvent | null, isFetching: boolean) => {
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

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Management</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Initial Fetch */}
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Initial Fetch</h3>
          <p className="text-sm text-gray-600 mb-4">
            Fetch all assets and their full funding history (last 480 hours)
          </p>
          <button
            onClick={handleInitialFetch}
            disabled={initialFetching || incrementalFetching}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {initialFetching ? 'Fetching...' : 'Fetch Initial Data'}
          </button>

          {renderProgress(initialProgress, initialFetching)}
        </div>

        {/* Incremental Fetch */}
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Incremental Update</h3>
          <p className="text-sm text-gray-600 mb-4">
            Fetch only new funding rates since the last update
          </p>
          <button
            onClick={handleIncrementalFetch}
            disabled={initialFetching || incrementalFetching}
            className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {incrementalFetching ? 'Updating...' : 'Update Data'}
          </button>

          {renderProgress(incrementalProgress, incrementalFetching)}
        </div>
      </div>
    </div>
  );
}
