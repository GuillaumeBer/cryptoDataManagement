import cron from 'node-cron';
import DataFetcherService from './dataFetcher';
import { logger } from '../utils/logger';

let scheduledTask: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  const cronExpression = process.env.FETCH_INTERVAL_CRON || '0 * * * *'; // Default: every hour

  if (!cron.validate(cronExpression)) {
    logger.error(`Invalid cron expression: ${cronExpression}`);
    return;
  }

  logger.info(`Starting scheduler with cron expression: ${cronExpression}`);

  scheduledTask = cron.schedule(cronExpression, async () => {
    logger.info('Scheduled incremental fetch started');

    try {
      const result = await DataFetcherService.fetchIncrementalData();

      logger.info('Scheduled incremental fetch completed', {
        assetsProcessed: result.assetsProcessed,
        recordsFetched: result.recordsFetched,
        errors: result.errors.length,
      });
    } catch (error) {
      logger.error('Scheduled incremental fetch failed', error);
    }
  });

  logger.info('Scheduler started successfully');
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Scheduler stopped');
  }
}

export function isSchedulerRunning(): boolean {
  return scheduledTask !== null;
}
