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

    // Ensure migrations tracking table exists
    await query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Run migration files in order
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // This will sort 000_*, 001_*, 002_*, etc. in order

    for (const file of migrationFiles) {
      // Check if migration has already been applied
      const checkResult = await query(
        'SELECT migration_name FROM schema_migrations WHERE migration_name = $1',
        [file]
      );

      if (checkResult.rows.length > 0) {
        logger.info(`Skipping already applied migration: ${file}`);
        continue;
      }

      logger.info(`Running migration: ${file}`);
      const migrationPath = join(migrationsDir, file);
      const migration = readFileSync(migrationPath, 'utf-8');

      // Remove comment-only lines before splitting by semicolons
      const cleanedMigration = migration
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          return trimmed.length > 0 && !trimmed.startsWith('--');
        })
        .join('\n');

      const migrationStatements = cleanedMigration
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of migrationStatements) {
        await query(statement);
      }

      // Record that this migration has been applied
      await query('INSERT INTO schema_migrations (migration_name) VALUES ($1)', [file]);

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
