import axios from 'axios';

async function testOKXOpenInterest() {
  const instId = 'BTC-USDT-SWAP';
  const baseURL = 'https://www.okx.com';
  
  console.log(`Testing OKX OI fetch for ${instId}...`);

  try {
    // Test 1: Fetch latest 1H data
    console.log('\n--- Test 1: Latest 1H Data ---');
    const url = `${baseURL}/api/v5/rubik/stat/contracts/open-interest-history`;
    const params1 = {
      instId,
      period: '1H',
      limit: '100'
    };
    
    const resp1 = await axios.get(url, { params: params1 });
    if (resp1.data.code !== '0') {
      console.error('Error fetching data:', resp1.data.msg);
      return;
    }
    
    const data1 = resp1.data.data;
    console.log(`Fetched ${data1.length} records.`);
    if (data1.length > 0) {
      console.log('First record:', new Date(parseInt(data1[0][0])).toISOString(), data1[0]);
      console.log('Last record:', new Date(parseInt(data1[data1.length - 1][0])).toISOString(), data1[data1.length - 1]);
    }

    // Test 2: Pagination (using 'after' or 'before' if supported)
    // The doc says 'begin' and 'end' usually, or 'after'/'before'.
    // Let's check what the response headers or docs say, but here we just try 'after' (older data)
    // OKX usually uses 'after' to get older data (id of the last record)
    
    if (data1.length > 0) {
      const lastTs = data1[data1.length - 1][0];
      console.log(`\n--- Test 2: Pagination (fetching older than ${new Date(parseInt(lastTs)).toISOString()}) ---`);
      
      // Try 'after' param (standard OKX pagination)
      // Note: Some rubik endpoints use 'end' instead of 'after'.
      // Let's try 'end' first as it's common for history endpoints, or check if 'after' works.
      // The client code mentioned 'before' didn't work.
      
      // Attempt 1: using 'end' (older than)
      const params2 = {
        instId,
        period: '1H',
        limit: '100',
        end: lastTs 
      };
      
      console.log('Trying with param "end"...');
      const resp2 = await axios.get(url, { params: params2 });
      const data2 = resp2.data.data;
      
      if (data2 && data2.length > 0) {
        console.log(`Fetched ${data2.length} records.`);
        console.log('First record:', new Date(parseInt(data2[0][0])).toISOString());
        console.log('Last record:', new Date(parseInt(data2[data2.length - 1][0])).toISOString());
      } else {
        console.log('No data with "end" param or empty.');
        
        // Attempt 2: using 'after'
        console.log('Trying with param "after"...');
        const params3 = {
            instId,
            period: '1H',
            limit: '100',
            after: lastTs
        };
        const resp3 = await axios.get(url, { params: params3 });
        const data3 = resp3.data.data;
         if (data3 && data3.length > 0) {
            console.log(`Fetched ${data3.length} records.`);
            console.log('First record:', new Date(parseInt(data3[0][0])).toISOString());
            console.log('Last record:', new Date(parseInt(data3[data3.length - 1][0])).toISOString());
         } else {
             console.log('No data with "after" param.');
         }
      }
    }

  } catch (error) {
    console.error('Request failed:', error.message);
    if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
    }
  }
}

testOKXOpenInterest();
