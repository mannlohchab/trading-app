import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { JSON_OID, parseJsonLossless } from '../../src/db/json';
import { fullSchema, type AppDatabase } from '../../src/db/types';

/** A fresh in-memory Postgres (PGlite) with all migrations applied. No Docker needed. */
export async function createTestDb() {
  const client = new PGlite({ extensions: { pgcrypto }, parsers: { [JSON_OID]: parseJsonLossless } });
  const db = drizzle(client, { schema: fullSchema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  return { db, appDb: db as unknown as AppDatabase, client, close: () => client.close() };
}
