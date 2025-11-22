import type { SystemStatus } from '../types';
import { formatLargeNumber, formatRelativeTime } from '../utils/formatters';

interface StatusBarProps {
  status?: SystemStatus;
  isLoading?: boolean;
  error?: unknown;
}

export default function StatusBar({ status, isLoading, error }: StatusBarProps) {
  if (isLoading) {
    return (
      <div className="bg-gray-50 border-t border-gray-200">
        <div className="px-4 py-3">
          <p className="text-sm text-gray-500">Loading platform status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-t border-red-200">
        <div className="px-4 py-3">
          <p className="text-sm text-red-700">Failed to load platform status.</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className="bg-blue-50 border-t border-blue-200">
      <div className="px-4 py-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-blue-600 font-medium">Platform</p>
            <p className="text-sm font-semibold text-blue-900 capitalize">
              {status.platform}
            </p>
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium">Assets</p>
            <p className="text-sm font-semibold text-blue-900">
              {formatLargeNumber(status.assetCount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium">Total Records</p>
            <p className="text-sm font-semibold text-blue-900">
              {formatLargeNumber(status.fundingRateCount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium">Liquidations</p>
            <p className="text-sm font-semibold text-blue-900">
              {formatLargeNumber(status.liquidationCount ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium">Last Fetch</p>
            <p className="text-sm font-semibold text-blue-900">
              {status.lastFetch
                ? formatRelativeTime(status.lastFetch.completedAt)
                : 'Never'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
