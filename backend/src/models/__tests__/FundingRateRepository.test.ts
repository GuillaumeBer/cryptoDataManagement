import AssetRepository from '../AssetRepository';
import FundingRateRepository from '../FundingRateRepository';

const assetRepo = AssetRepository;
const fundingRepo = FundingRateRepository;

describe('FundingRateRepository', () => {
  it('creates funding rates and queries them with filters', async () => {
    const asset = await assetRepo.create({ symbol: 'BTCUSDT', platform: 'binance', name: 'BTC' });

    await fundingRepo.create({
      asset_id: asset.id,
      timestamp: new Date('2024-01-01T00:00:00Z'),
      funding_rate: '0.0001',
      premium: '0.0002',
      platform: 'binance',
      sampling_interval: '1h',
    });

    await fundingRepo.create({
      asset_id: asset.id,
      timestamp: new Date('2024-01-01T08:00:00Z'),
      funding_rate: '0.0003',
      premium: '0.0001',
      platform: 'binance',
      sampling_interval: '1h',
    });

    const results = await fundingRepo.find({
      asset: 'BTCUSDT',
      platform: 'binance',
      sampling_interval: '1h',
      limit: 10,
      offset: 0,
    });

    expect(results).toHaveLength(2);
    expect(results[0].asset_symbol).toBe('BTCUSDT');
  });

  it('returns the latest timestamp for an asset/platform pair', async () => {
    const asset = await assetRepo.create({ symbol: 'ETHUSDT', platform: 'binance', name: 'ETH' });

    await fundingRepo.create({
      asset_id: asset.id,
      timestamp: new Date('2024-01-01T00:00:00Z'),
      funding_rate: '0.0001',
      premium: '0.0001',
      platform: 'binance',
      sampling_interval: '1h',
    });

    await fundingRepo.create({
      asset_id: asset.id,
      timestamp: new Date('2024-01-02T00:00:00Z'),
      funding_rate: '0.0005',
      premium: '0.0001',
      platform: 'binance',
      sampling_interval: '1h',
    });

    const latest = await fundingRepo.getLatestTimestamp(asset.id, 'binance', '1h');
    expect(latest).toEqual(new Date('2024-01-02T00:00:00.000Z'));
  });
});
