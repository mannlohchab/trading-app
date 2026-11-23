import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as relations from './relations';
import * as schema from './schema';

export const fullSchema = { ...schema, ...relations };
export type FullSchema = typeof fullSchema;

/** Any Drizzle Postgres database with our schema: postgres.js in production, PGlite in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppDatabase = PgDatabase<any, FullSchema>;
