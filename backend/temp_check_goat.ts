import 'dotenv/config';
import { query } from './src/database/connection';

(async () => {
  const result = await query(
    "SELECT id, normalized_symbol, coingecko_id, coingecko_name, market_cap_usd FROM unified_assets WHERE normalized_symbol ILIKE '%GOAT%'"
  );
  console.log('GOAT assets:');
  console.table(result.rows);
  process.exit(0);
})().catch(console.error);
