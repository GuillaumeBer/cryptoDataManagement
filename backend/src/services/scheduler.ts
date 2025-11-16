import cron from 'node-cron';
import dataFetcherManager from './dataFetcherManager';
import { logger } from '../utils/logger';

type PlatformRunStatus = 'success' | 'partial' | 'failed';

interface PlatformRunSummary {
  platform: string;
  status: PlatformRunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  assetsProcessed?: number;
  recordsFetched?: number;
  error?: string;
}

type SchedulerRunState = PlatformRunStatus | 'idle' | 'running';

interface SchedulerRunSummary {
  state: SchedulerRunState;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  results: PlatformRunSummary[];
  error?: string;
}

interface SchedulerStatus {
  cronExpression: string;
  isScheduled: boolean;
  isJobRunning: boolean;
  lastRun: SchedulerRunSummary | null;
}

let scheduledTask: cron.ScheduledTask | null = null;
let currentCronExpression = '';
let isJobRunning = false;
let lastRunSummary: SchedulerRunSummary | null = null;

function getConfiguredPlatforms(): string[] {
  const envPlatforms = process.env.SCHEDULER_PLATFORMS
    ?.split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (envPlatforms && envPlatforms.length > 0) {
    return envPlatforms;
  }

  const managerPlatforms = dataFetcherManager.getAllPlatforms();
  if (managerPlatforms.length > 0) {
    return managerPlatforms;
  }

  return [process.env.DEFAULT_PLATFORM?.toLowerCase() || 'hyperliquid'];
}

function determineRunState(results: PlatformRunSummary[]): PlatformRunStatus {
  if (results.every((result) => result.status === 'success')) {
    return 'success';
  }
  if (results.some((result) => result.status === 'success' || result.status === 'partial')) {
    return 'partial';
  }
  return 'failed';
}

function updateLastRun(summary: SchedulerRunSummary): void {
  lastRunSummary = summary;
}

export async function runScheduledFetch(): Promise<void> {
  if (isJobRunning) {
    logger.warn('Scheduled incremental fetch is already running, skipping this tick');
    return;
  }

  const runStartedAt = new Date();
  const platforms = getConfiguredPlatforms();

  if (platforms.length === 0) {
    const errorMessage = 'No platforms configured for scheduler';
    logger.warn(errorMessage);
    updateLastRun({
      state: 'failed',
      startedAt: runStartedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      results: [],
      error: errorMessage,
    });
    return;
  }

  logger.info('Scheduled incremental fetch started', { platforms });
  isJobRunning = true;
  updateLastRun({
    state: 'running',
    startedAt: runStartedAt.toISOString(),
    results: [],
  });

  const runResults: PlatformRunSummary[] = [];

  try {
    for (const platform of platforms) {
      const platformStart = Date.now();
      const platformSummary: PlatformRunSummary = {
        platform,
        status: 'failed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };

      try {
        const fetcher = dataFetcherManager.getFetcher(platform);
        logger.info('Scheduled incremental fetch starting for platform', { platform });
        const result = await fetcher.fetchIncrementalData();
        const platformStatus: PlatformRunStatus = result.errors.length > 0 ? 'partial' : 'success';

        platformSummary.status = platformStatus;
        platformSummary.assetsProcessed = result.assetsProcessed;
        platformSummary.recordsFetched = result.recordsFetched;
        if (result.errors.length > 0) {
          platformSummary.error = result.errors.join('; ');
        }

        logger.info('Scheduled incremental fetch completed for platform', {
          platform,
          status: platformStatus,
          durationMs: Date.now() - platformStart,
          assetsProcessed: result.assetsProcessed,
          recordsFetched: result.recordsFetched,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        platformSummary.status = 'failed';
        platformSummary.error = errorMessage;
        logger.error('Scheduled incremental fetch failed for platform', {
          platform,
          error: errorMessage,
          durationMs: Date.now() - platformStart,
        });
      } finally {
        platformSummary.completedAt = new Date().toISOString();
        platformSummary.durationMs = Date.now() - platformStart;
        runResults.push(platformSummary);
      }
    }

    const runCompletedAt = new Date();
    const state = determineRunState(runResults);
    updateLastRun({
      state,
      startedAt: runStartedAt.toISOString(),
      completedAt: runCompletedAt.toISOString(),
      durationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
      results: runResults,
    });

    logger.info('Scheduled incremental fetch run completed', {
      state,
      durationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
      platformsProcessed: runResults.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const runCompletedAt = new Date();
    updateLastRun({
      state: 'failed',
      startedAt: runStartedAt.toISOString(),
      completedAt: runCompletedAt.toISOString(),
      durationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
      results: runResults,
      error: errorMessage,
    });
    logger.error('Scheduled incremental fetch run failed', { error: errorMessage });
  } finally {
    isJobRunning = false;
  }
}

export function startScheduler(): void {
  const cronExpression = process.env.FETCH_INTERVAL_CRON || '0 * * * *'; // Default: every hour

  if (!cron.validate(cronExpression)) {
    logger.error(`Invalid cron expression: ${cronExpression}`);
    return;
  }

  logger.info(`Starting scheduler with cron expression: ${cronExpression}`);
  currentCronExpression = cronExpression;

  scheduledTask = cron.schedule(cronExpression, runScheduledFetch);

  logger.info('Scheduler started successfully');
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentCronExpression = '';
    isJobRunning = false;
    logger.info('Scheduler stopped');
  }
}

export function isSchedulerRunning(): boolean {
  return scheduledTask !== null;
}

export function getSchedulerStatus(): SchedulerStatus {
  return {
    cronExpression: currentCronExpression,
    isScheduled: scheduledTask !== null,
    isJobRunning,
    lastRun: lastRunSummary,
  };
}
