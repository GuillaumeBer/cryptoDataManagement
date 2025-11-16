import AssetRepository from '../AssetRepository';

const repository = AssetRepository;

describe('AssetRepository', () => {
  it('creates or updates assets via create()', async () => {
    const created = await repository.create({ symbol: 'BTCUSDT', platform: 'binance', name: 'BTC' });

    expect(created.id).toBeDefined();
    expect(created.name).toBe('BTC');

    const updated = await repository.create({ symbol: 'BTCUSDT', platform: 'binance', name: 'Bitcoin Perp' });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('Bitcoin Perp');

    const assets = await repository.findByPlatform('binance');
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe('Bitcoin Perp');
  });

  it('deactivates missing symbols for a platform', async () => {
    await repository.create({ symbol: 'BTCUSDT', platform: 'binance', name: 'BTC' });
    await repository.create({ symbol: 'ETHUSDT', platform: 'binance', name: 'ETH' });

    const deactivated = await repository.deactivateMissingSymbols('binance', ['ETHUSDT']);
    expect(deactivated).toBe(1);

    const activeAssets = await repository.findByPlatform('binance');
    expect(activeAssets).toHaveLength(1);
    expect(activeAssets[0].symbol).toBe('ETHUSDT');
  });
});
