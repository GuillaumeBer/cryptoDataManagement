import 'dotenv/config';
import { query, testConnection, closePool } from './connection';
import { logger } from '../utils/logger';

async function fixSymbolLength() {
  try {
    logger.info('Fixing symbol column length...');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Manually apply the ALTER statements from migration 002
    logger.info('Increasing symbol column in assets table to VARCHAR(100)');
    await query('ALTER TABLE assets ALTER COLUMN symbol TYPE VARCHAR(100)');

    logger.info('Increasing normalized_symbol column in unified_assets table to VARCHAR(100)');
    await query('ALTER TABLE unified_assets ALTER COLUMN normalized_symbol TYPE VARCHAR(100)');

    logger.info('Symbol column length fix completed successfully');

    // Verify the change
    const result = await query(`
      SELECT column_name, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'assets' AND column_name = 'symbol'
    `);

    if (result.rows.length > 0) {
      logger.info('Symbol column updated', {
        character_maximum_length: result.rows[0].character_maximum_length,
      });
    }
  } catch (error) {
    logger.error('Fix failed', error);
    throw error;
  } finally {
    await closePool();
  }
}

// Run if called directly
if (require.main === module) {
  fixSymbolLength()
    .then(() => {
      logger.info('✓ Fix completed - symbol column is now VARCHAR(100)');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('✗ Fix failed:', error);
      process.exit(1);
    });
}

export default fixSymbolLength;
