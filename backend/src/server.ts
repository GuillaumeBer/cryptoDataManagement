import 'dotenv/config';
import net from 'node:net';
import type { Server } from 'node:http';
import app from './app';
import { logger } from './utils/logger';
import { testConnection } from './database/connection';
import { startScheduler, stopScheduler } from './services/scheduler';

const PORT = normalizePort(process.env.PORT);
let server: Server | null = null;
let isShuttingDown = false;

function normalizePort(value?: string): number {
  if (!value) {
    return 3000;
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }

  logger.warn(`Invalid PORT value "${value}" provided. Falling back to 3000.`);
  return 3000;
}

function ensurePortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.unref();

    tester.once('error', (error: NodeJS.ErrnoException) => {
      if (tester.listening) {
        tester.close();
      }
      reject(error);
    });

    tester.once('listening', () => {
      tester.close(() => resolve());
    });

    tester.listen(port, '0.0.0.0');
  });
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === 'object' && 'code' in (error as Record<string, unknown>);
}

function handleServerError(error: NodeJS.ErrnoException): never {
  if (error.code === 'EADDRINUSE') {
    logger.error(
      `Port ${PORT} is already in use. Stop the other process or set a different PORT value in backend/.env.`
    );
  } else {
    logger.error('Unexpected error while starting the HTTP server', {
      error: error.message,
      stack: error.stack,
    });
  }

  stopScheduler();
  process.exit(1);
}

function gracefulShutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);
  stopScheduler();

  if (server) {
    server.close((closeError?: Error) => {
      if (closeError) {
        logger.error('Error while closing HTTP server', { error: closeError.message });
        process.exit(1);
      }

      logger.info('HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

function handleUnexpectedStartupError(error: unknown): never {
  const isError = error instanceof Error;
  logger.error('Failed to start server', {
    error: isError ? error.message : String(error),
    stack: isError ? error.stack : undefined,
  });

  stopScheduler();
  process.exit(1);
}

async function startServer(): Promise<void> {
  try {
    await ensurePortAvailable(PORT);

    logger.info('Testing database connection...');
    const connected = await testConnection();

    if (!connected) {
      logger.error('Failed to connect to database. Please check your DATABASE_URL');
      process.exit(1);
    }

    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`API available at http://localhost:${PORT}/api`);

      if (process.env.FETCH_INTERVAL_CRON) {
        startScheduler();
      } else {
        logger.warn('FETCH_INTERVAL_CRON not set, scheduler will not run');
      }
    });

    server.on('error', (error: NodeJS.ErrnoException) => handleServerError(error));
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EADDRINUSE') {
      handleServerError(error);
    }

    handleUnexpectedStartupError(error);
  }
}

startServer();

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
