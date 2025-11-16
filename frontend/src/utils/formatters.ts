import { format } from 'date-fns';

function toNumber(value: number | string): number {
  return typeof value === 'string' ? parseFloat(value) : value;
}

export function formatNumber(value: number | string, decimals: number = 4): string {
  const num = toNumber(value);
  return num.toFixed(decimals);
}

export function formatPercentage(value: number | string, decimals: number = 4): string {
  const num = toNumber(value);
  return `${num.toFixed(decimals)}%`;
}

export function formatFractionToPercent(value: number | string, decimals: number = 4): string {
  const num = toNumber(value);
  return formatPercentage(num * 100, decimals);
}

export function formatDate(date: string | Date, formatStr: string = 'MMM dd, yyyy HH:mm'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, formatStr);
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return formatDate(d);
}

export function formatLargeNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}K`;
  }
  return value.toString();
}
