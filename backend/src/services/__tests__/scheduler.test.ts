import dataFetcherManager from '../dataFetcherManager';
import { getSchedulerStatus, runScheduledFetch } from '../scheduler';

jest.mock('../dataFetcherManager', () => ({
  __esModule: true,
  default: {
    getFetcher: jest.fn(),
    getAllPlatforms: jest.fn().mockReturnValue([]),
  },
}));

describe('scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SCHEDULER_PLATFORMS = 'binance';
  });

  it('runs incremental fetches for configured platforms', async () => {
    const fetcherMock = {
      fetchIncrementalData: jest.fn().mockResolvedValue({
        assetsProcessed: 2,
        recordsFetched: 10,
        errors: [],
      }),
    };

    (dataFetcherManager.getFetcher as jest.Mock).mockReturnValue(fetcherMock);

    await runScheduledFetch();

    expect(fetcherMock.fetchIncrementalData).toHaveBeenCalledTimes(1);
    const status = getSchedulerStatus();
    expect(status.lastRun?.state).toBe('success');
    expect(status.lastRun?.results[0].platform).toBe('binance');
  });
});
