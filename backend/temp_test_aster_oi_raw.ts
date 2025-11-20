import 'dotenv/config';
import axios from 'axios';

async function testAsterOIRaw() {
  try {
    const baseURL = 'https://fapi.asterdex.com';
    const symbol = 'BTCUSDT';

    console.log('\n=== Testing Aster Open Interest Endpoints ===\n');

    // Test 1: Historical endpoint (Binance-compatible)
    console.log('Test 1: /futures/data/openInterestHist (Historical)');
    try {
      const hoursAgo = 480;
      const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
      const endTime = Date.now();

      const response1 = await axios.get(`${baseURL}/futures/data/openInterestHist`, {
        params: {
          symbol,
          period: '1h',
          contractType: 'PERPETUAL',
          startTime,
          endTime,
          limit: 500,
        },
        timeout: 10000,
      });

      console.log('Status:', response1.status);
      console.log('Data length:', Array.isArray(response1.data) ? response1.data.length : 'Not an array');
      console.log('Sample data:', JSON.stringify(response1.data).substring(0, 500));
    } catch (error: any) {
      console.log('Error:', error.response?.status, error.message);
      console.log('Response:', JSON.stringify(error.response?.data).substring(0, 500));
    }

    // Test 2: Real-time endpoint (Binance-compatible)
    console.log('\n\nTest 2: /fapi/v1/openInterest (Real-time)');
    try {
      const response2 = await axios.get(`${baseURL}/fapi/v1/openInterest`, {
        params: { symbol },
        timeout: 10000,
      });

      console.log('Status:', response2.status);
      console.log('Data:', JSON.stringify(response2.data, null, 2));
    } catch (error: any) {
      console.log('Error:', error.response?.status, error.message);
      console.log('Response:', JSON.stringify(error.response?.data).substring(0, 500));
    }

    // Test 3: Check what endpoints are available
    console.log('\n\nTest 3: /fapi/v1/exchangeInfo');
    try {
      const response3 = await axios.get(`${baseURL}/fapi/v1/exchangeInfo`, {
        timeout: 10000,
      });

      const symbols = response3.data.symbols.filter((s: any) =>
        s.symbol === symbol && s.contractType === 'PERPETUAL'
      );
      console.log('Symbol info:', JSON.stringify(symbols[0], null, 2));
    } catch (error: any) {
      console.log('Error:', error.response?.status, error.message);
    }

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

testAsterOIRaw();
