import request from 'supertest';
import { createApp } from '../../app';
import AssetRepository from '../../models/AssetRepository';
import FundingRateRepository from '../../models/FundingRateRepository';

describe('GET /api/funding-rates', () => {
  it('responds with filtered funding rates', async () => {
    const asset = await AssetRepository.create({ symbol: 'BTCUSDT', platform: 'binance', name: 'Bitcoin' });

    await FundingRateRepository.create({
      asset_id: asset.id,
      timestamp: new Date('2024-02-01T00:00:00Z'),
      funding_rate: '0.0002',
      premium: '0.0001',
      platform: 'binance',
      sampling_interval: '1h',
    });

    const app = createApp();
    const response = await request(app)
      .get('/api/funding-rates')
      .query({ asset: 'BTCUSDT', platform: 'binance', sampling_interval: '1h' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].asset_symbol).toBe('BTCUSDT');
    expect(response.body.count).toBe(1);
  });
});
