import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import apiRoutes from './routes/api';
import { logger } from './utils/logger';
import { testConnection } from './database/connection';
import { startScheduler } from './services/scheduler';
import allowedOrigins from './config/allowedOrigins';

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
// Disable compression for Server-Sent Events (SSE) endpoints
app.use(compression({
  filter: (req: Request, res: Response) => {
    // Don't compress SSE streams
    if (req.path.includes('/stream')) {
      return false;
    }
    // Use default compression for everything else
    return compression.filter(req, res);
  }
}));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// API routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Crypto Data Management API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      status: '/api/status',
      assets: '/api/assets',
      fundingRates: '/api/funding-rates',
      fetch: 'POST /api/fetch',
      incrementalFetch: 'POST /api/fetch/incremental',
      analytics: '/api/analytics/:asset',
      logs: '/api/logs',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
async function startServer() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    const connected = await testConnection();

    if (!connected) {
      logger.error('Failed to connect to database. Please check your DATABASE_URL');
      process.exit(1);
    }

    // Start the scheduler for incremental updates
    if (process.env.FETCH_INTERVAL_CRON) {
      startScheduler();
    } else {
      logger.warn('FETCH_INTERVAL_CRON not set, scheduler will not run');
    }

    // Start Express server
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

export default app;
