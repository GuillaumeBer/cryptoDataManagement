import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/api';

// System hooks
export function useSystemStatus(platform?: string) {
  return useQuery({
    queryKey: ['status', platform],
    queryFn: () => apiClient.getStatus(platform),
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

// Asset hooks
export function useAssets(platform?: string) {
  return useQuery({
    queryKey: ['assets', platform],
    queryFn: () => apiClient.getAssets(platform),
  });
}

// Funding rate hooks
export function useFundingRates(params: {
  asset?: string;
  startDate?: Date;
  endDate?: Date;
  platform?: string;
  sampling_interval?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['funding-rates', params],
    queryFn: () => apiClient.getFundingRates(params),
    enabled: !!params.asset, // Only fetch if asset is selected
  });
}

// Analytics hooks
export function useAssetAnalytics(asset: string | null, platform: string = 'hyperliquid') {
  return useQuery({
    queryKey: ['analytics', asset, platform],
    queryFn: () => apiClient.getAssetAnalytics(asset!, platform),
    enabled: !!asset,
  });
}

// Logs hooks
export function useFetchLogs(limit: number = 10) {
  return useQuery({
    queryKey: ['logs', limit],
    queryFn: () => apiClient.getLogs(limit),
  });
}

// Mutation hooks
export function useInitialFetch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.triggerInitialFetch(),
    onSuccess: () => {
      // Invalidate and refetch relevant queries
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });
}

export function useIncrementalFetch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.triggerIncrementalFetch(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['funding-rates'] });
      queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });
}
