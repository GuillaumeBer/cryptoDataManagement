import 'dotenv/config';
import { query, testConnection, closePool } from './connection';
import { logger } from '../utils/logger';

async function verifySchema() {
  try {
    logger.info('Verifying database schema...');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Check the actual column type in the database
    const result = await query(`
      SELECT
        column_name,
        data_type,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'assets'
        AND column_name IN ('symbol', 'name')
      ORDER BY column_name;
    `);

    console.log('\n=== Assets Table Column Info ===');
    result.rows.forEach((row) => {
      console.log(`${row.column_name}: ${row.data_type}(${row.character_maximum_length})`);
    });

    // Check applied migrations
    const migrations = await query(`
      SELECT migration_name, applied_at
      FROM schema_migrations
      ORDER BY applied_at;
    `);

    console.log('\n=== Applied Migrations ===');
    migrations.rows.forEach((row) => {
      console.log(`${row.migration_name} - ${row.applied_at}`);
    });

    console.log('\n');
    logger.info('Schema verification completed');
  } catch (error) {
    logger.error('Schema verification failed', error);
    throw error;
  } finally {
    await closePool();
  }
}

// Run if called directly
if (require.main === module) {
  verifySchema()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Verification failed:', error);
      process.exit(1);
    });
}

export default verifySchema;
