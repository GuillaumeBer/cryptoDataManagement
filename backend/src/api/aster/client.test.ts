import { AsterClient } from './client';

describe('AsterClient', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the fapi.asterdex.com base URL by default', () => {
    const client = new AsterClient();
    expect((client as any).baseURL).toBe('https://fapi.asterdex.com');
  });

  it('prefers ASTER_API_URL from environment variables when provided', () => {
    process.env.ASTER_API_URL = 'https://custom.aster.test';
    const client = new AsterClient();
    expect((client as any).baseURL).toBe('https://custom.aster.test');
    delete process.env.ASTER_API_URL;
  });

  it('requests the last 480 hours of funding data for a symbol', async () => {
    const client = new AsterClient();
    const mockGet = jest.fn().mockResolvedValue({ data: [] });
    (client as any).client = { get: mockGet };

    const now = new Date('2024-01-01T00:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await client.getFundingHistory('BTCUSDT');

    expect(mockGet).toHaveBeenCalledWith('/fapi/v1/fundingRate', {
      params: expect.objectContaining({
        symbol: 'BTCUSDT',
        limit: 1000,
      }),
    });

    const params = mockGet.mock.calls[0][1].params;
    expect(params.endTime).toBe(now);
    expect(params.startTime).toBe(now - 480 * 60 * 60 * 1000);
  });
});
