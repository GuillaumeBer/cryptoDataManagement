import axios, { AxiosInstance } from 'axios';
import type {
  Asset,
  FundingRate,
  SystemStatus,
  FetchResult,
  AssetAnalytics,
  FetchLog,
  ApiResponse,
  OHLCVRecord,
} from '../types';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
      timeout: 60000, // 60 seconds for fetch operations
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  getBaseUrl() {
    return this.client.defaults.baseURL ?? '';
  }

  // System endpoints
  async getStatus(platform?: string): Promise<SystemStatus> {
    const params = platform ? { platform } : {};
    const response = await this.client.get<ApiResponse<SystemStatus>>('/status', { params });
    return response.data.data!;
  }

  async getHealth(): Promise<{ status: string; timestamp: string }> {
    const response = await this.client.get('/health');
    return response.data;
  }

  // Fetch endpoints
  async triggerInitialFetch(): Promise<FetchResult> {
    const response = await this.client.post<ApiResponse<FetchResult>>('/fetch');
    return response.data.data!;
  }

  async triggerIncrementalFetch(): Promise<FetchResult> {
    const response = await this.client.post<ApiResponse<FetchResult>>('/fetch/incremental');
    return response.data.data!;
  }

  // Asset endpoints
  async getAssets(platform?: string): Promise<Asset[]> {
    const params = platform ? { platform } : {};
    const response = await this.client.get<ApiResponse<Asset[]>>('/assets', { params });
    return response.data.data!;
  }

  // Funding rate endpoints
  async getFundingRates(params: {
    asset?: string;
    startDate?: Date;
    endDate?: Date;
    platform?: string;
    sampling_interval?: string;
    limit?: number;
    offset?: number;
  }): Promise<FundingRate[]> {
    const queryParams: any = { ...params };

    if (queryParams.startDate) {
      queryParams.startDate = queryParams.startDate.toISOString();
    }
    if (queryParams.endDate) {
      queryParams.endDate = queryParams.endDate.toISOString();
    }

    const response = await this.client.get<ApiResponse<FundingRate[]>>('/funding-rates', {
      params: queryParams,
    });
    return response.data.data!;
  }

  // OHLCV endpoints
  async getOHLCV(params: {
    asset?: string;
    platform?: string;
    timeframe?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<OHLCVRecord[]> {
    const queryParams: Record<string, any> = { ...params };

    if (queryParams.startDate) {
      queryParams.startDate = queryParams.startDate.toISOString();
    }
    if (queryParams.endDate) {
      queryParams.endDate = queryParams.endDate.toISOString();
    }

    const response = await this.client.get<ApiResponse<OHLCVRecord[]>>('/ohlcv', {
      params: queryParams,
    });
    return response.data.data ?? [];
  }

  // Analytics endpoints
  async getAssetAnalytics(asset: string, platform: string = 'hyperliquid'): Promise<AssetAnalytics> {
    const response = await this.client.get<ApiResponse<AssetAnalytics>>(
      `/analytics/${asset}`,
      { params: { platform } }
    );
    return response.data.data!;
  }

  // Logs endpoints
  async getLogs(limit: number = 10): Promise<FetchLog[]> {
    const response = await this.client.get<ApiResponse<FetchLog[]>>('/logs', {
      params: { limit },
    });
    return response.data.data!;
  }
}

export const apiClient = new ApiClient();
export default apiClient;
