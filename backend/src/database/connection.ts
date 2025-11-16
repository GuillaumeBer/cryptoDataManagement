import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    try {
      const url = new URL(connectionString);
      logger.debug('Connecting to database', {
        host: url.hostname,
        port: url.port,
        database: url.pathname.replace('/', ''),
        sslmode: url.searchParams.get('sslmode') || undefined,
      });
    } catch (error) {
      logger.debug('Connecting to database with provided connection string');
      logger.warn('Failed to parse DATABASE_URL for logging', error);
    }

    pool = new Pool({
      connectionString,
      max: parseInt(process.env.DATABASE_POOL_SIZE || '10'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected database pool error', err);
    });

    logger.info('Database pool created');
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();

  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    logger.debug('Executed query', {
      text: text.substring(0, 100),
      duration,
      rows: result.rowCount,
    });

    return result;
  } catch (error) {
    logger.error('Database query error', { text, error });
    throw error;
  }
}

export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW()');
    logger.info('Database connection test successful', {
      time: result.rows[0].now,
    });
    return true;
  } catch (error) {
    logger.error('Database connection test failed', error);
    return false;
  }
}
