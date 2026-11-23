import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import { JSON_OID, parseJsonLossless } from './json';
import { fullSchema, type AppDatabase } from './types';

// postgres.js connects lazily, so importing this module never opens a connection by itself.
export const sql = postgres(config.database.url, {
  max: config.database.poolMax,
  ssl: config.database.ssl === 'require' ? 'require' : false,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
  // Keep NUMERIC precision inside relational-query JSON (see ./json.ts).
  types: { json: { to: JSON_OID, from: [JSON_OID], serialize: JSON.stringify, parse: parseJsonLossless } },
});

export const db: AppDatabase = drizzle(sql, { schema: fullSchema, casing: 'snake_case' });
export type Database = AppDatabase;

export async function pingDatabase(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export const closeDatabase = () => sql.end({ timeout: 5 });
