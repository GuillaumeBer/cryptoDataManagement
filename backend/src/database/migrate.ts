import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { query, testConnection, closePool } from './connection';
import { logger } from '../utils/logger';

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Read and execute schema
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Split by semicolons and execute each statement
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await query(statement);
    }

    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', error);
    throw error;
  } finally {
    await closePool();
  }
}

// Run if called directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('✓ Migrations completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Migration failed:', error);
      process.exit(1);
    });
}

export default runMigrations;
