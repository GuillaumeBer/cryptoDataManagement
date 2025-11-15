import { Request, Response } from 'express';
import { ProgressEvent, DataFetcherService } from '../services/dataFetcher';
import dataFetcherManager from '../services/dataFetcherManager';
import { logger } from '../utils/logger';
import { allowedOrigins, isOriginAllowed } from '../config/allowedOrigins';

const LISTENER_MAP_KEY = '__sseProgressListeners';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

const getHeartbeatInterval = (): number => {
  const override = Number(process.env.SSE_HEARTBEAT_INTERVAL_MS);
  if (!Number.isNaN(override) && override > 0) {
    return override;
  }
  return DEFAULT_HEARTBEAT_INTERVAL_MS;
};

type TriggerFetch = (fetcher: DataFetcherService) => Promise<unknown>;

interface ProgressStreamOptions {
  getFetcher?: (platform: string) => DataFetcherService;
}

type ProgressListener = (event: ProgressEvent) => void;

type ProgressListenerMap = Map<string, ProgressListener>;

const getListenerMap = (res: Response): ProgressListenerMap => {
  const existing = (res.locals as Record<string, unknown>)[LISTENER_MAP_KEY] as ProgressListenerMap | undefined;
  if (existing) {
    return existing;
  }

  const map: ProgressListenerMap = new Map();
  (res.locals as Record<string, unknown>)[LISTENER_MAP_KEY] = map;
  return map;
};

const buildListenerKey = (routePath: string, platform: string): string => `${routePath}:${platform}`;

const writeEvent = (res: Response, payload: unknown): void => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const createProgressStream = (
  routePath: string,
  triggerFetch?: TriggerFetch,
  options?: ProgressStreamOptions
) => {
  return async (req: Request, res: Response) => {
    const platform = (req.query.platform as string) || 'hyperliquid';
    const getFetcher = options?.getFetcher ?? ((name: string) => dataFetcherManager.getFetcher(name));
    const fetcher = getFetcher(platform);

    const origin = req.get('origin');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Vary', 'Origin');

    if (isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin!);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (!origin && allowedOrigins.length > 0) {
      // No origin provided (curl, server-to-server). Fall back to the first allowed origin
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    }

    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);

    res.flushHeaders();

    logger.info(`[SSE:${routePath}] stream opened for platform ${platform}`);

    const listenerKey = buildListenerKey(routePath, platform);
    const listenerMap = getListenerMap(res);

    const cleanup = () => {
      const stored = listenerMap.get(listenerKey);
      if (stored) {
        fetcher.removeListener('progress', stored);
        listenerMap.delete(listenerKey);
      }
    };

    let cleanupAll = () => {
      cleanup();
    };

    const progressListener: ProgressListener = (event: ProgressEvent) => {
      logger.debug(`[SSE:${routePath}] ${platform} ${event.type} ${event.processedAssets}/${event.totalAssets}`);
      writeEvent(res, event);

      if (event.type === 'complete' || event.type === 'error') {
        writeEvent(res, { type: 'done' });
        cleanupAll();
        if (!res.writableEnded) {
          res.end();
        }
      }
    };

    // Avoid duplicate listeners on the same response
    if (listenerMap.has(listenerKey)) {
      const existing = listenerMap.get(listenerKey)!;
      fetcher.removeListener('progress', existing);
    }

    listenerMap.set(listenerKey, progressListener);
    fetcher.on('progress', progressListener);

    const heartbeatIntervalMs = getHeartbeatInterval();
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, heartbeatIntervalMs);

    if (typeof heartbeat.unref === 'function') {
      heartbeat.unref();
    }

    cleanupAll = () => {
      clearInterval(heartbeat);
      cleanup();
    };

    req.on('close', cleanupAll);
    req.on('error', cleanupAll);
    res.on('close', cleanupAll);
    res.on('finish', cleanupAll);

    writeEvent(res, { type: 'connected', platform });

    const currentProgress = fetcher.getCurrentProgress();
    if (currentProgress) {
      writeEvent(res, currentProgress);
    }

    try {
      if (!fetcher.isFetchInProgress() && triggerFetch) {
        await triggerFetch(fetcher);
      } else if (fetcher.isFetchInProgress()) {
        logger.info(`[SSE:${routePath}] ${platform} fetch already in progress, listening for updates`);
      }
    } catch (error) {
      logger.error(`[SSE:${routePath}] error`, error);
      writeEvent(res, { type: 'error', message: `${error}` });
      writeEvent(res, { type: 'done' });
      cleanupAll();
      res.end();
    }
  };
};

export default createProgressStream;
