import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import apiRoutes from './routes/api';
import { logger } from './utils/logger';
import allowedOrigins from './config/allowedOrigins';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    compression({
      filter: (req: Request, res: Response) => {
        if (req.path.includes('/stream')) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
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

  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    next();
  });

  app.use('/api', apiRoutes);

  app.get('/', (_req: Request, res: Response) => {
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

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: 'Endpoint not found',
      path: req.path,
    });
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
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

  return app;
}

const app = createApp();
export default app;
