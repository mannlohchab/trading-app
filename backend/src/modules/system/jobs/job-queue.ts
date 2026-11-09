// PostgreSQL job queue on the existing `background_jobs` table. No other queue system is used.
//
//  - claim:    one atomic UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1), so concurrent
//              workers never receive the same job.
//  - fencing:  complete/fail only apply while the row is still locked by the same worker and
//              attempt, so a worker whose lease expired cannot overwrite a newer attempt.
//  - recovery: RUNNING jobs whose lease expired are re-queued (or failed once out of attempts).
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { backgroundJobs } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';

export type JobRecord = typeof backgroundJobs.$inferSelect;
type Executor = Pick<AppDatabase, 'insert' | 'update' | 'select' | 'execute'>;

export type EnqueueInput = {
  id?: string;
  type: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
  maxAttempts?: number;
  /** With a key, an enqueue while a PENDING/RUNNING job of the same type and key exists returns that job. */
  dedupeKey?: string;
};

export class PostgresJobQueue {
  constructor(private readonly db: AppDatabase, private readonly now: () => Date = () => new Date()) {}

  /** Pass a transaction to enqueue atomically with the caller's own writes. */
  async enqueue(input: EnqueueInput, tx: Executor = this.db): Promise<JobRecord> {
    const values = {
      ...(input.id && { id: input.id }),
      jobType: input.type,
      payload: input.payload,
      availableAt: input.availableAt ?? this.now(),
      maxAttempts: input.maxAttempts ?? 3,
      dedupeKey: input.dedupeKey ?? null,
    };
    if (!input.dedupeKey) return (await tx.insert(backgroundJobs).values(values).returning())[0]!;
    const [inserted] = await tx.insert(backgroundJobs).values(values).onConflictDoNothing().returning();
    if (inserted) return inserted;
    const [active] = await tx.select().from(backgroundJobs).where(and(
      eq(backgroundJobs.jobType, input.type), eq(backgroundJobs.dedupeKey, input.dedupeKey), inArray(backgroundJobs.status, ['PENDING', 'RUNNING']),
    ));
    // The active job may have finished between the two statements; then enqueue a fresh one.
    return active ?? this.enqueue(input, tx);
  }

  /** Atomically claims the oldest available job of the given types, or returns null. */
  async claim(types: string[], workerId: string): Promise<JobRecord | null> {
    if (!types.length) return null;
    // Raw SQL bypasses Drizzle's column mapping, and postgres.js rejects Date parameters: pass an ISO string.
    const now = sql`${this.now().toISOString()}::timestamptz`;
    const typeList = sql.join(types.map(t => sql`${t}`), sql`, `);
    const result = await this.db.execute(sql`
      UPDATE ${backgroundJobs}
         SET status = 'RUNNING', locked_at = ${now}, locked_by = ${workerId}, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM ${backgroundJobs}
          WHERE status = 'PENDING' AND available_at <= ${now} AND job_type IN (${typeList})
          ORDER BY available_at, created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id`);
    const id = (result as unknown as { rows?: { id: string }[] }).rows?.[0]?.id ?? (result as unknown as { id: string }[])[0]?.id;
    if (!id) return null;
    const [row] = await this.db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id));
    return row ?? null;
  }

  private owned(job: JobRecord) {
    return and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.status, 'RUNNING'), eq(backgroundJobs.lockedBy, job.lockedBy ?? ''), eq(backgroundJobs.attempts, job.attempts));
  }

  /** Marks a claimed job finished. Returns false if the lease was lost to another worker. */
  async complete(job: JobRecord, status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED', tx: Executor = this.db): Promise<boolean> {
    const rows = await tx.update(backgroundJobs)
      .set({ status, completedAt: this.now(), lockedAt: null, lockedBy: null })
      .where(this.owned(job)).returning({ id: backgroundJobs.id });
    return rows.length > 0;
  }

  /**
   * Records a failure. Retryable failures with attempts left go back to PENDING after an
   * exponential backoff; everything else becomes FAILED. Returns the resulting status.
   */
  async fail(job: JobRecord, error: string, retryable: boolean): Promise<'PENDING' | 'FAILED' | 'LOST'> {
    const retry = retryable && job.attempts < job.maxAttempts;
    const rows = await this.db.update(backgroundJobs)
      .set(retry
        ? { status: 'PENDING', availableAt: new Date(this.now().getTime() + backoffMs(job.attempts)), lockedAt: null, lockedBy: null, lastError: error.slice(0, 2000) }
        : { status: 'FAILED', completedAt: this.now(), lockedAt: null, lockedBy: null, lastError: error.slice(0, 2000) })
      .where(this.owned(job)).returning({ id: backgroundJobs.id });
    return rows.length ? (retry ? 'PENDING' : 'FAILED') : 'LOST';
  }

  /** Cancels a job that has not started. Running jobs are cancelled cooperatively by their handler. */
  async cancelPending(id: string, tx: Executor = this.db): Promise<boolean> {
    const rows = await tx.update(backgroundJobs).set({ status: 'CANCELLED', completedAt: this.now() })
      .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.status, 'PENDING'))).returning({ id: backgroundJobs.id });
    return rows.length > 0;
  }

  /**
   * Re-queues RUNNING jobs whose lease expired (the worker crashed or was killed). Jobs out of
   * attempts are failed and returned so their owners can record the failure.
   */
  async recoverStale(types: string[], leaseMs: number): Promise<{ requeued: number; exhausted: JobRecord[] }> {
    if (!types.length) return { requeued: 0, exhausted: [] };
    const cutoff = new Date(this.now().getTime() - leaseMs);
    const stale = and(eq(backgroundJobs.status, 'RUNNING'), lt(backgroundJobs.lockedAt, cutoff), inArray(backgroundJobs.jobType, types));
    const requeued = await this.db.update(backgroundJobs)
      .set({ status: 'PENDING', lockedAt: null, lockedBy: null, availableAt: this.now(), lastError: 'Worker lease expired; re-queued' })
      .where(and(stale, sql`${backgroundJobs.attempts} < ${backgroundJobs.maxAttempts}`)).returning({ id: backgroundJobs.id });
    const exhausted = await this.db.update(backgroundJobs)
      .set({ status: 'FAILED', completedAt: this.now(), lockedAt: null, lockedBy: null, lastError: 'Worker lease expired and no attempts remain' })
      .where(and(stale, sql`${backgroundJobs.attempts} >= ${backgroundJobs.maxAttempts}`)).returning();
    return { requeued: requeued.length, exhausted };
  }

  find(id: string) {
    return this.db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).then(r => r[0] ?? null);
  }
}

/** 30 s, 1 min, 2 min, … capped at 30 min. */
export const backoffMs = (attempt: number) => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
