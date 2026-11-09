// Polls the queue and runs registered handlers. Only claims job types it has a handler for, so
// other job types in `background_jobs` (e.g. account purges) are left alone.
import type { JobRecord, PostgresJobQueue } from './job-queue';

export class RetryableJobError extends Error {
  constructor(message: string) { super(message); this.name = 'RetryableJobError'; }
}

export type JobContext = { attempt: number; maxAttempts: number; isLastAttempt: boolean };

export interface JobHandler {
  readonly type: string;
  /** Throw RetryableJobError for transient failures; any other error fails the job permanently. */
  handle(job: JobRecord, ctx: JobContext): Promise<'COMPLETED' | 'CANCELLED'>;
  /** Called when a job fails for good (permanent error, attempts used up, or stale with none left). */
  onFailed?(job: JobRecord, error: string): Promise<void>;
}

type Log = (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;

export class JobRunner {
  private running = false;
  private loops: Promise<void>[] = [];
  private lastRecovery = 0;

  constructor(private readonly deps: {
    queue: PostgresJobQueue;
    handlers: JobHandler[];
    workerId: string;
    concurrency?: number;
    pollIntervalMs?: number;
    leaseMs: number;
    log?: Log;
  }) {}

  private get types() { return this.deps.handlers.map(h => h.type); }

  start() {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < (this.deps.concurrency ?? 1); i++) this.loops.push(this.loop());
  }

  async stop() {
    this.running = false;
    await Promise.allSettled(this.loops);
    this.loops = [];
  }

  /** Recovers stale jobs, then claims and runs at most one job. Returns whether a job ran. */
  async tick(): Promise<boolean> {
    await this.recover();
    const job = await this.deps.queue.claim(this.types, this.deps.workerId);
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  private async loop() {
    let failures = 0;
    while (this.running) {
      let worked = false;
      try {
        worked = await this.tick();
        failures = 0;
      } catch (error) {
        // e.g. the database is unreachable: back off instead of hammering it and the logs.
        failures++;
        if (failures === 1 || Number.isInteger(Math.log2(failures))) this.deps.log?.('error', 'Job loop error', { error: message(error), consecutiveFailures: failures });
      }
      const poll = this.deps.pollIntervalMs ?? 1000;
      if (!worked && this.running) await Bun.sleep(failures ? Math.min(30_000, poll * 2 ** Math.min(failures, 5)) : poll);
    }
  }

  private async recover() {
    if (Date.now() - this.lastRecovery < Math.min(this.deps.leaseMs, 30_000)) return;
    this.lastRecovery = Date.now();
    const { requeued, exhausted } = await this.deps.queue.recoverStale(this.types, this.deps.leaseMs);
    if (requeued) this.deps.log?.('warn', 'Re-queued stale jobs', { count: requeued });
    for (const job of exhausted) await this.handler(job)?.onFailed?.(job, 'The worker stopped responding and no attempts remain').catch(() => {});
  }

  private handler(job: JobRecord) {
    return this.deps.handlers.find(h => h.type === job.jobType);
  }

  private async execute(job: JobRecord) {
    const handler = this.handler(job)!;
    const ctx = { attempt: job.attempts, maxAttempts: job.maxAttempts, isLastAttempt: job.attempts >= job.maxAttempts };
    const started = Date.now();
    try {
      const status = await handler.handle(job, ctx);
      const kept = await this.deps.queue.complete(job, status);
      this.deps.log?.(kept ? 'info' : 'warn', kept ? 'Job finished' : 'Job finished after its lease was lost', { jobId: job.id, type: job.jobType, status, ms: Date.now() - started });
    } catch (error) {
      const retryable = error instanceof RetryableJobError;
      const outcome = await this.deps.queue.fail(job, message(error), retryable);
      this.deps.log?.(outcome === 'FAILED' ? 'error' : 'warn', 'Job failed', { jobId: job.id, type: job.jobType, attempt: job.attempts, retryable, outcome, error: message(error) });
      if (outcome === 'FAILED') await handler.onFailed?.(job, message(error)).catch(e => this.deps.log?.('error', 'onFailed handler failed', { error: message(e) }));
    }
  }
}

/** Error message including its cause chain (Drizzle wraps driver errors as "Failed query: …"). */
const message = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  const first = e.message.split('\n')[0]!.slice(0, 200);
  return e.cause ? `${first} ← ${message(e.cause)}` : first;
};
