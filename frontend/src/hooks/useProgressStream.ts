import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../services/api';
import type { ProgressEvent } from '../types';

type StreamStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

type ProgressUpdater = ProgressEvent | null | ((prev: ProgressEvent | null) => ProgressEvent | null);

export function useProgressStream(platform: string) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [currentType, setCurrentType] = useState<'initial' | 'incremental' | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const retryCountRef = useRef(0);
  const isUnmountedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      shouldReconnectRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  const hydrateProgress = useCallback((updater: ProgressUpdater) => {
    setProgress((prev) => (typeof updater === 'function' ? (updater as (value: ProgressEvent | null) => ProgressEvent | null)(prev) : updater));
  }, []);

  const connect = useCallback((type: 'initial' | 'incremental') => {
    cleanup();
    const endpoint = type === 'initial' ? '/fetch/stream' : '/fetch/incremental/stream';
    const baseUrl =
      apiClient.getBaseUrl() || (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api';
    const url = `${baseUrl}${endpoint}?platform=${platform}`;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      retryCountRef.current = 0;
      setStatus('connected');
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected' || data.type === 'done') {
          if (data.type === 'done') {
            shouldReconnectRef.current = false;
            setStatus('closed');
            cleanup();
          }
          return;
        }

        setProgress(data as ProgressEvent);

        if (data.type === 'complete') {
          shouldReconnectRef.current = false;
          setStatus('closed');
          cleanup();
        } else if (data.type === 'error') {
          shouldReconnectRef.current = false;
          setStatus('error');
          setError(data.errors?.[0] ?? 'Fetch failed');
          cleanup();
        }
      } catch (parseError) {
        setError('Received malformed progress update');
      }
    };

    eventSource.onerror = () => {
      cleanup();
      if (!shouldReconnectRef.current) {
        setStatus('error');
        setError('Connection closed');
        return;
      }

      setStatus('reconnecting');
      setError('Connection lost. Retrying...');
      retryCountRef.current += 1;
      const baseDelay = Math.min(1000 * 2 ** (retryCountRef.current - 1), 10000);
      const jitter = Math.random() * 500;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!shouldReconnectRef.current || isUnmountedRef.current) return;
        connect(type);
      }, baseDelay + jitter);
    };
  }, [cleanup, platform]);

  const start = useCallback((type: 'initial' | 'incremental') => {
    shouldReconnectRef.current = true;
    retryCountRef.current = 0;
    setCurrentType(type);
    setStatus('connecting');
    setError(null);
    connect(type);
  }, [connect]);

  const stop = useCallback(() => {
    shouldReconnectRef.current = false;
    setCurrentType(null);
    setStatus('idle');
    setError(null);
    cleanup();
  }, [cleanup]);

  return {
    progress,
    status,
    error,
    currentType,
    start,
    stop,
    hydrateProgress,
  } as const;
}
