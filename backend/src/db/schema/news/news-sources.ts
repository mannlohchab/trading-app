import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createdAt, timestamptz, updatedAt } from '../columns';

/**
 * Poll state per news source (the source list itself is configuration). `next_run_at` is the
 * schedule: the queued `news.poll` job for a source carries it, and only the job whose time still
 * matches may record a poll, so duplicate jobs from several processes are harmless.
 */
export const newsSources = pgTable(
  'news_sources',
  {
    id: varchar({ length: 50 }).primaryKey(),
    name: varchar({ length: 100 }).notNull(),
    kind: varchar({ length: 20 }).notNull(),
    nextRunAt: timestamptz().notNull(),
    lastAttemptAt: timestamptz(),
    lastSuccessAt: timestamptz(),
    lastError: text(),
    consecutiveFailures: integer().notNull().default(0),
    lastItemCount: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [check('news_sources_failures_chk', sql`${t.consecutiveFailures} >= 0`)],
);
