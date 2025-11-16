import type { FetchLog, SchedulerStatus } from '../types';
import { formatRelativeTime } from '../utils/formatters';

interface SchedulerWidgetProps {
  scheduler?: SchedulerStatus;
  recentErrors?: FetchLog[];
}

const schedulerStateColors: Record<string, string> = {
  success: 'text-green-700 bg-green-50',
  partial: 'text-yellow-700 bg-yellow-50',
  failed: 'text-red-700 bg-red-50',
  running: 'text-blue-700 bg-blue-50',
  idle: 'text-gray-700 bg-gray-100',
};

const fetchStatusColors: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border border-green-100',
  partial: 'bg-yellow-50 text-yellow-700 border border-yellow-100',
  failed: 'bg-red-50 text-red-700 border border-red-100',
};

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) {
    return 'Unknown';
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getSchedulerBadge(state?: string): string {
  if (!state) {
    return 'bg-gray-100 text-gray-700';
  }

  return schedulerStateColors[state] || 'bg-gray-100 text-gray-700';
}

function getStatusLabel(state?: string): string {
  if (!state) {
    return 'Unknown';
  }
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export default function SchedulerWidget({ scheduler, recentErrors }: SchedulerWidgetProps) {
  const lastRun = scheduler?.lastRun;
  const hasSchedulerInfo = Boolean(scheduler);
  const hasErrors = Boolean(recentErrors && recentErrors.length > 0);

  if (!hasSchedulerInfo && !hasErrors) {
    return null;
  }

  return (
    <div className="mb-8 grid gap-6 lg:grid-cols-2">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Scheduler</h3>
            <p className="text-sm text-gray-500">
              {scheduler ? `Cron: ${scheduler.cronExpression || 'N/A'}` : 'Scheduler is not configured.'}
            </p>
          </div>
          {scheduler && (
            <span
              className={`px-2 py-1 text-xs font-semibold rounded-full ${
                scheduler.isJobRunning
                  ? schedulerStateColors.running
                  : scheduler.isScheduled
                  ? schedulerStateColors.idle
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {scheduler.isJobRunning ? 'Running' : scheduler.isScheduled ? 'Scheduled' : 'Stopped'}
            </span>
          )}
        </div>

        {scheduler ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Last run status</p>
                <span
                  className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getSchedulerBadge(
                    lastRun?.state
                  )}`}
                >
                  {lastRun ? getStatusLabel(lastRun.state) : 'Never'}
                </span>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Last activity</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {lastRun?.completedAt || lastRun?.startedAt
                    ? formatRelativeTime(lastRun?.completedAt || lastRun?.startedAt || new Date())
                    : 'No history'}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Duration</span>
                <span className="font-medium text-gray-900">{formatDuration(lastRun?.durationMs)}</span>
              </div>
              <div className="mt-2 flex justify-between">
                <span>Platforms processed</span>
                <span className="font-medium text-gray-900">{lastRun?.results.length || 0}</span>
              </div>
              {lastRun?.error && (
                <p className="mt-3 text-sm text-red-600">{lastRun.error}</p>
              )}
            </div>

            {lastRun?.results.length ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Latest platform results</p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {lastRun.results.map((result) => (
                    <div
                      key={`${result.platform}-${result.startedAt}`}
                      className={`rounded-md px-3 py-2 text-sm flex items-center justify-between ${
                        fetchStatusColors[result.status] || 'bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div>
                        <p className="font-semibold capitalize">{result.platform}</p>
                        <p className="text-xs text-gray-600">{formatRelativeTime(result.completedAt)}</p>
                      </div>
                      <div className="text-right text-xs text-gray-600">
                        <p>{result.status.toUpperCase()}</p>
                        {typeof result.durationMs === 'number' && (
                          <p>{formatDuration(result.durationMs)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">Scheduler configuration not found.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Recent Errors</h3>
            <p className="text-sm text-gray-500">Latest fetch issues across all platforms</p>
          </div>
          <span className="text-xs text-gray-500">{recentErrors?.length || 0} items</span>
        </div>

        {hasErrors ? (
          <ul className="mt-4 divide-y divide-gray-100">
            {recentErrors!.map((log) => (
              <li key={log.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between text-sm">
                  <p className="font-semibold capitalize text-gray-900">{log.platform}</p>
                  <span
                    className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                      fetchStatusColors[log.status] || 'bg-gray-100 text-gray-700 border border-gray-200'
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{log.error_message || 'No error details provided.'}</p>
                <div className="mt-2 flex justify-between text-xs text-gray-500">
                  <span>{formatRelativeTime(log.completed_at || log.started_at)}</span>
                  <span className="capitalize">{log.fetch_type} fetch</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No recent errors across all platforms.</p>
        )}
      </div>
    </div>
  );
}
