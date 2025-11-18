import { useState, useEffect } from 'react';
import type { UnifiedAsset, ApiResponse } from '../types';

interface UseUnifiedAssetsOptions {
  minPlatforms?: number;
  enabled?: boolean;
}

export function useUnifiedAssets(options: UseUnifiedAssetsOptions = {}) {
  const { minPlatforms = 2, enabled = true } = options;

  const [assets, setAssets] = useState<UnifiedAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function fetchUnifiedAssets() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `/api/unified-assets/multi-platform?minPlatforms=${minPlatforms}`
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result: ApiResponse<UnifiedAsset[]> = await response.json();

        if (isMounted) {
          if (result.success && result.data) {
            setAssets(result.data);
          } else {
            throw new Error(result.error || 'Failed to fetch unified assets');
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Unknown error'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchUnifiedAssets();

    return () => {
      isMounted = false;
    };
  }, [minPlatforms, enabled]);

  return { assets, isLoading, error };
}
