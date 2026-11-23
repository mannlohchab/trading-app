import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, jsonObject, timestamptz, updatedAt } from '../columns';
import { backgroundJobStatus } from '../enums';

/** Postgres-backed job queue. Claim with SELECT … FOR UPDATE SKIP LOCKED on PENDING rows. */
export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: id(),
    jobType: varchar({ length: 50 }).notNull(),
    payload: jsonObject(),
    status: backgroundJobStatus().notNull().default('PENDING'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    availableAt: timestamptz().notNull().defaultNow(),
    lockedAt: timestamptz(),
    lockedBy: varchar({ length: 100 }),
    lastError: text(),
    /** At most one PENDING/RUNNING job per (type, key); repeated enqueues collapse into it. */
    dedupeKey: varchar({ length: 200 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamptz(),
  },
  t => [
    check('background_jobs_attempts_chk', sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`),
    index('background_jobs_claim_idx').on(t.availableAt, t.createdAt).where(sql`${t.status} = 'PENDING'`),
    uniqueIndex('background_jobs_active_dedupe_uq').on(t.jobType, t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} IN ('PENDING', 'RUNNING')`),
    index('background_jobs_stale_lock_idx').on(t.lockedAt).where(sql`${t.status} = 'RUNNING'`),
  ],
);

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;
