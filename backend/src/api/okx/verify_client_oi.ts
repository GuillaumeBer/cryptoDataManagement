import { OKXClient } from './client';

async function verifyOKXClientOI() {
  const client = new OKXClient();
  const instId = 'BTC-USDT-SWAP';

  console.log(`Verifying OKXClient.getOpenInterest for ${instId}...`);

  try {
    const data = await client.getOpenInterest(instId, '1H');
    
    console.log(`Fetched ${data.length} records.`);
    
    if (data.length > 0) {
      console.log('First record:', data[0]);
      console.log('Last record:', data[data.length - 1]);
      
      // Check if we got more than 100 records (implies pagination worked)
      if (data.length > 100) {
        console.log('SUCCESS: Pagination worked (fetched > 100 records).');
      } else {
        console.log('WARNING: Fetched <= 100 records. Might be correct if history is short, but check logs.');
      }
      
      // Check time difference between records
      const t1 = data[0].timestamp.getTime();
      const t2 = data[1].timestamp.getTime();
      const diffHours = Math.abs(t1 - t2) / (1000 * 60 * 60);
      console.log(`Time difference between first two records: ${diffHours} hours`);
      
      if (Math.abs(diffHours - 1) < 0.1) {
         console.log('SUCCESS: Time interval appears to be 1 hour.');
      } else {
         console.log(`WARNING: Time interval is ${diffHours} hours, expected 1 hour.`);
      }

    } else {
      console.log('ERROR: No data fetched.');
    }

  } catch (error) {
    console.error('Verification failed:', error);
  }
}

verifyOKXClientOI();
