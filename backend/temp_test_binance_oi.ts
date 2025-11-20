import 'dotenv/config';
import BinanceClient from './src/api/binance/client';

async function testBinanceOI() {
  try {
    const client = new BinanceClient();

    // Test with BTC
    console.log('Testing Binance OI fetch for BTCUSDT...');
    const btcOI = await client.getOpenInterest('BTCUSDT', '1h');

    console.log(`Fetched ${btcOI.length} OI records for BTCUSDT`);
    if (btcOI.length > 0) {
      console.log('Sample record:', btcOI[0]);
    }

    // Test batch fetch with a few symbols
    console.log('\nTesting batch fetch for multiple symbols...');
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const batchResult = await client.getOpenInterestBatch(symbols, '1h', 700, 1);

    for (const [symbol, data] of batchResult.entries()) {
      console.log(`${symbol}: ${data.length} records`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testBinanceOI();
