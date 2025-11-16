import 'dotenv/config';
import app from './app';
import { logger } from './utils/logger';
import { testConnection } from './database/connection';
import { startScheduler } from './services/scheduler';

const PORT = process.env.PORT || 3000;

async function startServer(): Promise<void> {
  try {
    logger.info('Testing database connection...');
    const connected = await testConnection();

    if (!connected) {
      logger.error('Failed to connect to database. Please check your DATABASE_URL');
      process.exit(1);
    }

    if (process.env.FETCH_INTERVAL_CRON) {
      startScheduler();
    } else {
      logger.warn('FETCH_INTERVAL_CRON not set, scheduler will not run');
    }

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`API available at http://localhost:${PORT}/api`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});
