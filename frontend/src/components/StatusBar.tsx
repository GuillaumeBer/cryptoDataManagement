import type { SystemStatus } from '../types';
import { formatLargeNumber, formatRelativeTime } from '../utils/formatters';

interface StatusBarProps {
  status?: SystemStatus;
}

export default function StatusBar({ status }: StatusBarProps) {
  if (!status) {
    return (
      <div className="bg-gray-100 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <p className="text-sm text-gray-500">Loading status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border-b border-blue-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
