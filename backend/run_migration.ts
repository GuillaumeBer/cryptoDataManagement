import 'dotenv/config';
import * as fs from 'fs';
import { query } from './src/database/connection';

async function runMigration() {
  const sql = fs.readFileSync('migrations/add_market_cap_rank.sql', 'utf8');
  await query(sql);
  console.log('[OK] Migration completed successfully');
  process.exit(0);
}

runMigration().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
