import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
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

    logger.info('Base schema applied');

    // Run migration files in order
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // This will sort 001_*, 002_*, etc. in order

    for (const file of migrationFiles) {
      logger.info(`Running migration: ${file}`);
      const migrationPath = join(migrationsDir, file);
      const migration = readFileSync(migrationPath, 'utf-8');

      const migrationStatements = migration
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      for (const statement of migrationStatements) {
        await query(statement);
      }

      logger.info(`Migration completed: ${file}`);
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
