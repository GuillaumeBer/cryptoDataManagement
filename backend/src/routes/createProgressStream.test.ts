import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';
import createProgressStream from './createProgressStream';
import { ProgressEvent, ProgressStageSnapshot, DataFetcherService } from '../services/dataFetcher';

const buildProgressEvent = (overrides: Partial<ProgressEvent> = {}): ProgressEvent => {
  const total = overrides.totalAssets ?? 10;
  const processed = overrides.processedAssets ?? 0;
  const stageKey = overrides.stage ?? 'fundingFetch';
  const stageSnapshots: ProgressStageSnapshot[] =
    overrides.stages ?? [
      {
        key: stageKey,
        label: 'Fetch funding rates',
        status: processed >= total ? 'complete' : 'active',
        completed: processed,
        total,
        percentage: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0,
      },
    ];

  return {
    type: 'progress',
    phase: 'fetch',
    stage: stageKey,
    stages: stageSnapshots,
    totalAssets: total,
    processedAssets: processed,
    currentAsset: overrides.currentAsset,
    recordsFetched: overrides.recordsFetched ?? processed,
    ohlcvRecordsFetched: overrides.ohlcvRecordsFetched,
    resampleRecordsCreated: overrides.resampleRecordsCreated,
    resampleAssetsProcessed: overrides.resampleAssetsProcessed,
    errors: overrides.errors ?? [],
    percentage:
      overrides.percentage ?? (total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0),
    message: overrides.message,
    ...overrides,
  };
};

class FakeFetcher extends EventEmitter {
  private inProgress = false;
  private currentProgress: ProgressEvent | null = null;
  private readonly autoEmit: boolean;

  constructor(autoEmit = true) {
    super();
    this.autoEmit = autoEmit;
  }

  fetchInitialData = jest.fn(async () => {
    this.inProgress = true;
    if (!this.autoEmit) {
      return;
    }
    this.pushProgress(
      buildProgressEvent({
        type: 'progress',
        totalAssets: 10,
        processedAssets: 5,
        currentAsset: 'BTC',
        recordsFetched: 5,
      })
    );
    this.pushProgress(
      buildProgressEvent({
        type: 'complete',
        totalAssets: 10,
        processedAssets: 10,
        currentAsset: 'ETH',
        recordsFetched: 10,
        percentage: 100,
      })
    );
  });

  fetchIncrementalData = jest.fn(async () => this.fetchInitialData());

  isFetchInProgress(): boolean {
    return this.inProgress;
  }

  getCurrentProgress(): ProgressEvent | null {
    return this.currentProgress;
  }

  startExternalFetch(): void {
    this.inProgress = true;
  }

  pushProgress(event: ProgressEvent): void {
    this.currentProgress = event;
    if (event.type === 'complete' || event.type === 'error') {
      this.inProgress = false;
    } else {
      this.inProgress = true;
    }
    this.emit('progress', event);
  }
}

const createApp = (handler: ReturnType<typeof createProgressStream>) => {
  const app = express();
  app.get('/stream', handler);
  return app;
};

const createFetcher = (autoEmit = true) => new FakeFetcher(autoEmit);

describe('createProgressStream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SSE_HEARTBEAT_INTERVAL_MS;
  });

  it('streams progress updates and closes when done', async () => {
    const fetcher = createFetcher();
    const handler = createProgressStream(
      'fetch/stream',
      async (instance) => instance.fetchInitialData(),
      {
        getFetcher: () => fetcher as unknown as DataFetcherService,
      }
    );
    const app = createApp(handler);

    const response = await request(app).get('/stream').set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('data: {"type":"connected","platform":"hyperliquid"}');
    expect(response.text).toContain('data: {"type":"progress"');
    expect(response.text).toContain('data: {"type":"complete"');
    expect(response.text).toContain('data: {"type":"done"}');
    expect(fetcher.fetchInitialData).toHaveBeenCalledTimes(1);
  });

  it('emits heartbeat comments and listens to externally started fetches', async () => {
    process.env.SSE_HEARTBEAT_INTERVAL_MS = '5';
    const fetcher = createFetcher(false);
    fetcher.startExternalFetch();

    const triggerFetch = jest.fn(async (instance: DataFetcherService) => instance.fetchInitialData());
    const handler = createProgressStream('fetch/stream', triggerFetch, {
      getFetcher: () => fetcher as unknown as DataFetcherService,
    });
    const app = createApp(handler);

    const responsePromise = request(app)
      .get('/stream')
      .set('Origin', 'http://localhost:5173')
      .then((res) => res);

    await new Promise((resolve) => setTimeout(resolve, 100));

    fetcher.pushProgress(
      buildProgressEvent({
        totalAssets: 4,
        processedAssets: 2,
        currentAsset: 'SOL',
        recordsFetched: 2,
        percentage: 50,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    fetcher.pushProgress(
      buildProgressEvent({
        type: 'complete',
        totalAssets: 4,
        processedAssets: 4,
        currentAsset: 'SOL',
        recordsFetched: 4,
        percentage: 100,
      })
    );

    const response = await responsePromise;

    expect(response.text).toContain(': heartbeat');
    expect(triggerFetch).not.toHaveBeenCalled();
  });
});
