import 'dotenv/config';
import { query, testConnection, closePool } from './connection';
import { logger } from '../utils/logger';

async function prepareMigrations() {
  try {
    logger.info('Preparing migrations tracking...');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Create migrations tracking table
    await query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);
    logger.info('Created schema_migrations table');

    // Mark migration 001 as already applied (since it's already in your database)
    await query(`
      INSERT INTO schema_migrations (migration_name)
      VALUES ('001_add_sampling_interval.sql')
      ON CONFLICT (migration_name) DO NOTHING
    `);
    logger.info('Marked migration 001 as already applied');

    logger.info('Migration preparation completed successfully');
    logger.info('You can now run: npm run db:migrate');
  } catch (error) {
    logger.error('Migration preparation failed', error);
    throw error;
  } finally {
    await closePool();
  }
}

// Run if called directly
if (require.main === module) {
  prepareMigrations()
    .then(() => {
      logger.info('✓ Migration preparation completed');
      logger.info('Now run: npm run db:migrate');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('✗ Migration preparation failed:', error);
      process.exit(1);
    });
}

export default prepareMigrations;
