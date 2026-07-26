import {drizzle} from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {config} from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

export const db = drizzle(pool, {schema});

export type Database = typeof db;

/** Fails fast at startup if Postgres is unreachable or misconfigured. */
export async function assertDatabaseReachable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select 1');
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
