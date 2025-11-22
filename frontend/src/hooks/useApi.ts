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

// OHLCV hooks
export function useOHLCVData(params: {
  asset?: string;
  platform?: string;
  timeframe?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['ohlcv', params],
    queryFn: () => apiClient.getOHLCV(params),
    enabled: !!params.asset,
  });
}

// Open Interest hooks
export function useOpenInterestData(params: {
  asset?: string;
  platform?: string;
  timeframe?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['open-interest', params],
    queryFn: () => apiClient.getOpenInterest(params),
    enabled: !!params.asset,
  });
}

// Long/Short Ratio hooks
export function useLongShortRatios(params: {
  asset?: string;
  platform?: string;
  timeframe?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['long-short-ratios', params],
    queryFn: () => apiClient.getLongShortRatios(params),
    enabled: !!params.asset,
  });
}

export function useLiquidations(params: {
  asset?: string;
  platform?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['liquidations', params],
    queryFn: () => apiClient.getLiquidations(params),
    enabled: !!params.asset && !!params.platform,
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
      queryClient.invalidateQueries({ queryKey: ['funding-rates'] });
      queryClient.invalidateQueries({ queryKey: ['ohlcv'] });
      queryClient.invalidateQueries({ queryKey: ['open-interest'] });
      queryClient.invalidateQueries({ queryKey: ['liquidations'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
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
      queryClient.invalidateQueries({ queryKey: ['ohlcv'] });
      queryClient.invalidateQueries({ queryKey: ['open-interest'] });
      queryClient.invalidateQueries({ queryKey: ['liquidations'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
