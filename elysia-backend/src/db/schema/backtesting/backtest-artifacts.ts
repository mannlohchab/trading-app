import { index, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../columns';
import { users } from '../identity/users';
import { backtestJobs } from './backtest-jobs';

/** Input artifacts are append-only. They survive changes to the shared market history. */
export const backtestSnapshots = pgTable('backtest_snapshots', {
  backtestJobId: uuid().primaryKey().references(() => backtestJobs.id, { onDelete: 'cascade' }),
  checksum: varchar({ length: 64 }).notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

/** User-owned historical imports, never silently mixed into the public market catalog. */
export const backtestDatasets = pgTable('backtest_datasets', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar({ length: 120 }).notNull(),
  checksum: varchar({ length: 64 }).notNull(),
  summary: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, t => [index('backtest_datasets_user_created_idx').on(t.userId, t.createdAt)]);

export const backtestExperiments = pgTable('backtest_experiments', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  datasetId: uuid().notNull().references(() => backtestDatasets.id, { onDelete: 'cascade' }),
  kind: varchar({ length: 30 }).notNull(),
  status: varchar({ length: 20 }).notNull().default('PENDING'),
  request: jsonb().$type<Record<string, unknown>>().notNull(),
  result: jsonb().$type<Record<string, unknown>>(),
  error: text(),
  createdAt: createdAt(),
}, t => [index('backtest_experiments_user_created_idx').on(t.userId, t.createdAt)]);
