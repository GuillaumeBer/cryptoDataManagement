import { OHLCVRepository } from '../models/OHLCVRepository';
import { AssetRepository } from '../models/AssetRepository';

export interface AlignedOHLCVData {
  assetId: number;
  platform: string;
  symbol: string;
  prices: number[];
  timestamps: Date[];
}

export interface CorrelationResult {
  asset1Id: number;
  asset2Id: number;
  correlation: number;
  sampleSize: number;
  isValid: boolean;
}

export interface ClusterResult {
  assetIds: number[];
  avgCorrelation: number;
  minCorrelation: number;
  maxCorrelation: number;
}

export class AssetCorrelationService {
  private ohlcvRepo: OHLCVRepository;
  private assetRepo: AssetRepository;
  private readonly MIN_DATA_POINTS = 48; // Minimum 48 hours of data
  private readonly MISSING_DATA_THRESHOLD = 0.1; // Allow up to 10% missing data

  constructor(ohlcvRepo: OHLCVRepository, assetRepo: AssetRepository) {
    this.ohlcvRepo = ohlcvRepo;
    this.assetRepo = assetRepo;
  }

  /**
   * Fetch OHLCV data for multiple assets and align timestamps
   * @param assetIds - Array of asset IDs to fetch
   * @param days - Number of days of historical data
   * @param timeframe - OHLCV timeframe (default: '1h')
   * @returns Array of aligned OHLCV data per asset
   */
  async fetchAlignedOHLCV(
    assetIds: number[],
    days: number = 14,
    timeframe: string = '1h'
  ): Promise<AlignedOHLCVData[]> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    // Fetch OHLCV data for all assets
    const allData: AlignedOHLCVData[] = [];

    for (const assetId of assetIds) {
      const asset = await this.assetRepo.findById(assetId);
      if (!asset) continue;

      const ohlcvData = await this.ohlcvRepo.find({
        assetId,
        platform: asset.platform,
        timeframe,
        startDate,
        endDate,
      });

      if (ohlcvData.length === 0) {
        console.warn(`No OHLCV data found for asset ${assetId} (${asset.symbol})`);
        continue;
      }

      allData.push({
        assetId,
        platform: asset.platform,
        symbol: asset.symbol,
        prices: ohlcvData.map((d) => parseFloat(d.close.toString())),
        timestamps: ohlcvData.map((d) => d.timestamp),
      });
    }

    // Find common timestamps across all assets
    const commonTimestamps = this.findCommonTimestamps(allData);

    if (commonTimestamps.length < this.MIN_DATA_POINTS) {
      console.warn(
        `Insufficient common data points: ${commonTimestamps.length} < ${this.MIN_DATA_POINTS}`
      );
    }

    // Align all asset data to common timestamps
    const alignedData: AlignedOHLCVData[] = allData.map((data) => {
      const alignedPrices = this.alignPricesToTimestamps(
        data.prices,
        data.timestamps,
        commonTimestamps
      );

      return {
        ...data,
        prices: alignedPrices,
        timestamps: commonTimestamps,
      };
    });

    return alignedData;
  }

  /**
   * Find timestamps that are common across all datasets
   * Uses a tolerance of ±5 minutes to account for platform differences
   */
  private findCommonTimestamps(datasets: AlignedOHLCVData[]): Date[] {
    if (datasets.length === 0) return [];
    if (datasets.length === 1) return datasets[0].timestamps;

    // Start with first dataset's timestamps
    const baseTimestamps = datasets[0].timestamps.map((t) => t.getTime());

    // Filter to only timestamps that exist in all datasets (with 5-minute tolerance)
    const commonTimestamps = baseTimestamps.filter((baseTime) => {
      return datasets.every((dataset) => {
        return dataset.timestamps.some((t) => {
          const diff = Math.abs(t.getTime() - baseTime);
          return diff <= 5 * 60 * 1000; // 5-minute tolerance
        });
      });
    });

    return commonTimestamps.map((time) => new Date(time));
  }

  /**
   * Align prices to a specific set of timestamps
   * Uses nearest neighbor interpolation for missing timestamps
   */
  private alignPricesToTimestamps(
    prices: number[],
    timestamps: Date[],
    targetTimestamps: Date[]
  ): number[] {
    const alignedPrices: number[] = [];

    for (const targetTime of targetTimestamps) {
      const targetTimeMs = targetTime.getTime();

      // Find closest timestamp
      let closestIdx = 0;
      let minDiff = Math.abs(timestamps[0].getTime() - targetTimeMs);

      for (let i = 1; i < timestamps.length; i++) {
        const diff = Math.abs(timestamps[i].getTime() - targetTimeMs);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      // Only use if within 5-minute tolerance
      if (minDiff <= 5 * 60 * 1000) {
        alignedPrices.push(prices[closestIdx]);
      } else {
        alignedPrices.push(NaN); // Mark as missing
      }
    }

    return alignedPrices;
  }

  /**
   * Calculate Pearson correlation coefficient between two price series
   * @param prices1 - First price series
   * @param prices2 - Second price series
   * @returns Correlation result with coefficient and validity
   */
  calculatePearsonCorrelation(
    prices1: number[],
    prices2: number[]
  ): CorrelationResult {
    if (prices1.length !== prices2.length) {
      throw new Error('Price arrays must have the same length');
    }

    // Filter out NaN values (missing data points)
    const validPairs: Array<[number, number]> = [];
    for (let i = 0; i < prices1.length; i++) {
      if (!isNaN(prices1[i]) && !isNaN(prices2[i])) {
        validPairs.push([prices1[i], prices2[i]]);
      }
    }

    const sampleSize = validPairs.length;
    const missingDataRatio = 1 - sampleSize / prices1.length;

    // Check if we have enough valid data
    const isValid =
      sampleSize >= this.MIN_DATA_POINTS &&
      missingDataRatio <= this.MISSING_DATA_THRESHOLD;

    if (!isValid || sampleSize === 0) {
      return {
        asset1Id: 0,
        asset2Id: 0,
        correlation: 0,
        sampleSize,
        isValid: false,
      };
    }

    // Calculate means
    const mean1 =
      validPairs.reduce((sum, pair) => sum + pair[0], 0) / sampleSize;
    const mean2 =
      validPairs.reduce((sum, pair) => sum + pair[1], 0) / sampleSize;

    // Calculate Pearson correlation coefficient
    let numerator = 0;
    let sum1Squared = 0;
    let sum2Squared = 0;

    for (const [p1, p2] of validPairs) {
      const diff1 = p1 - mean1;
      const diff2 = p2 - mean2;
      numerator += diff1 * diff2;
      sum1Squared += diff1 * diff1;
      sum2Squared += diff2 * diff2;
    }

    const denominator = Math.sqrt(sum1Squared * sum2Squared);

    // Avoid division by zero
    const correlation = denominator === 0 ? 0 : numerator / denominator;

    return {
      asset1Id: 0,
      asset2Id: 0,
      correlation,
      sampleSize,
      isValid: true,
    };
  }

  /**
   * Calculate correlation matrix for multiple assets
   * @param alignedData - Array of aligned OHLCV data
   * @returns 2D matrix of correlation coefficients
   */
  calculateCorrelationMatrix(
    alignedData: AlignedOHLCVData[]
  ): Map<string, CorrelationResult> {
    const correlationMap = new Map<string, CorrelationResult>();

    for (let i = 0; i < alignedData.length; i++) {
      for (let j = i + 1; j < alignedData.length; j++) {
        const result = this.calculatePearsonCorrelation(
          alignedData[i].prices,
          alignedData[j].prices
        );

        result.asset1Id = alignedData[i].assetId;
        result.asset2Id = alignedData[j].assetId;

        const key = `${alignedData[i].assetId}-${alignedData[j].assetId}`;
        correlationMap.set(key, result);

        console.log(
          `Correlation between ${alignedData[i].platform}:${alignedData[i].symbol} and ` +
            `${alignedData[j].platform}:${alignedData[j].symbol}: ${result.correlation.toFixed(4)} ` +
            `(n=${result.sampleSize})`
        );
      }
    }

    return correlationMap;
  }

  /**
   * Find clusters of highly correlated assets
   * @param correlationMatrix - Map of pairwise correlations
   * @param threshold - Minimum correlation threshold (default: 0.95)
   * @returns Array of asset clusters
   */
  findCorrelationClusters(
    correlationMatrix: Map<string, CorrelationResult>,
    threshold: number = 0.95
  ): ClusterResult[] {
    // Build adjacency list of assets connected by high correlation
    const adjacency = new Map<number, Set<number>>();

    for (const [key, result] of correlationMatrix.entries()) {
      if (!result.isValid || result.correlation < threshold) continue;

      if (!adjacency.has(result.asset1Id)) {
        adjacency.set(result.asset1Id, new Set());
      }
      if (!adjacency.has(result.asset2Id)) {
        adjacency.set(result.asset2Id, new Set());
      }

      adjacency.get(result.asset1Id)!.add(result.asset2Id);
      adjacency.get(result.asset2Id)!.add(result.asset1Id);
    }

    // Find connected components using DFS
    const visited = new Set<number>();
    const clusters: ClusterResult[] = [];

    const dfs = (assetId: number, cluster: number[]): void => {
      visited.add(assetId);
      cluster.push(assetId);

      const neighbors = adjacency.get(assetId) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, cluster);
        }
      }
    };

    // Find all clusters
    for (const assetId of adjacency.keys()) {
      if (!visited.has(assetId)) {
        const cluster: number[] = [];
        dfs(assetId, cluster);

        // Calculate cluster statistics
        const clusterCorrelations: number[] = [];
        for (let i = 0; i < cluster.length; i++) {
          for (let j = i + 1; j < cluster.length; j++) {
            const key1 = `${cluster[i]}-${cluster[j]}`;
            const key2 = `${cluster[j]}-${cluster[i]}`;
            const result =
              correlationMatrix.get(key1) || correlationMatrix.get(key2);
            if (result && result.isValid) {
              clusterCorrelations.push(result.correlation);
            }
          }
        }

        if (clusterCorrelations.length > 0) {
          clusters.push({
            assetIds: cluster,
            avgCorrelation:
              clusterCorrelations.reduce((sum, c) => sum + c, 0) /
              clusterCorrelations.length,
            minCorrelation: Math.min(...clusterCorrelations),
            maxCorrelation: Math.max(...clusterCorrelations),
          });
        }
      }
    }

    return clusters;
  }

  /**
   * Convert correlation coefficient to confidence score (0-100)
   */
  correlationToConfidence(correlation: number): number {
    // Map correlation to confidence score
    // 0.98+ → 98-100
    // 0.95-0.98 → 95-98
    // 0.90-0.95 → 90-95
    // <0.90 → <90

    if (correlation >= 0.98) {
      return Math.round(98 + (correlation - 0.98) * 100);
    } else if (correlation >= 0.95) {
      return Math.round(95 + (correlation - 0.95) * 100);
    } else if (correlation >= 0.90) {
      return Math.round(90 + (correlation - 0.90) * 100);
    } else {
      return Math.round(correlation * 100);
    }
  }

  /**
   * Calculate average correlation for an asset within a cluster
   */
  calculateAvgCorrelationForAsset(
    assetId: number,
    clusterAssetIds: number[],
    correlationMatrix: Map<string, CorrelationResult>
  ): number {
    const correlations: number[] = [];

    for (const otherAssetId of clusterAssetIds) {
      if (otherAssetId === assetId) continue;

      const key1 = `${assetId}-${otherAssetId}`;
      const key2 = `${otherAssetId}-${assetId}`;
      const result =
        correlationMatrix.get(key1) || correlationMatrix.get(key2);

      if (result && result.isValid) {
        correlations.push(result.correlation);
      }
    }

    if (correlations.length === 0) return 0;

    return correlations.reduce((sum, c) => sum + c, 0) / correlations.length;
  }
}
