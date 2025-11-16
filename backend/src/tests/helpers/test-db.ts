import { newDb, IMemoryDb } from 'pg-mem';
import path from 'path';
import fs from 'fs';
import type { Pool } from 'pg';

let memoryDb: IMemoryDb | null = null;
let testPool: Pool | null = null;

const schemaPath = path.join(__dirname, '../../database/schema.sql');
const rawSchemaSql = fs.readFileSync(schemaPath, 'utf-8');
const schemaSql = rawSchemaSql.replace(/DECIMAL\(20,\s*10\)/gi, 'NUMERIC');

export function initTestDb(): { db: IMemoryDb; pool: Pool } {
  if (memoryDb && testPool) {
    return { db: memoryDb, pool: testPool };
  }

  memoryDb = newDb({ autoCreateForeignKeyIndices: true });
  memoryDb.public.none(schemaSql);

  const adapter = memoryDb.adapters.createPg();
  testPool = new adapter.Pool();

  return { db: memoryDb, pool: testPool as unknown as Pool };
}

export function getTestPool(): Pool {
  if (!testPool) {
    throw new Error('Test database has not been initialized. Call initTestDb() first.');
  }

  return testPool;
}

export async function resetTestDb(): Promise<void> {
  if (!testPool) {
    return;
  }

  const tables = ['funding_rates', 'asset_mappings', 'assets', 'unified_assets', 'fetch_logs'];
  for (const table of tables) {
    await testPool.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  }
}

export async function closeTestDb(): Promise<void> {
  if (testPool) {
    await testPool.end();
  }

  memoryDb = null;
  testPool = null;
}
