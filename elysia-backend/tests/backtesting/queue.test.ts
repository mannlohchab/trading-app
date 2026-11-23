// The PostgreSQL job queue on background_jobs.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { backgroundJobs } from '../../src/db/schema';
import { backoffMs, JobRunner, PostgresJobQueue, RetryableJobError, type JobHandler } from '../../src/modules/system/jobs';
import { FakeClock } from '../helpers/test-app';
import { createTestDb } from '../helpers/test-db';

let t: Awaited<ReturnType<typeof createTestDb>>;
const clock = new FakeClock(new Date('2026-11-09T12:00:00Z'));
let queue: PostgresJobQueue;
beforeAll(async () => { t = await createTestDb(); queue = new PostgresJobQueue(t.appDb, clock.now); });
afterAll(() => t.close());

const fresh = async () => { await t.db.delete(backgroundJobs); };

describe('claiming', () => {
  test('a job is claimed by exactly one worker', async () => {
    await fresh();
    const job = await queue.enqueue({ type: 'test.a', payload: { n: 1 } });
    const [a, b] = await Promise.all([queue.claim(['test.a'], 'w1'), queue.claim(['test.a'], 'w2')]);
    expect([a?.id, b?.id].filter(Boolean)).toEqual([job.id]);
    const claimed = (a ?? b)!;
    expect(claimed).toMatchObject({ status: 'RUNNING', attempts: 1 });
    expect(await queue.claim(['test.a'], 'w3')).toBeNull();
  });

  test('only matching, due job types are claimed, oldest first', async () => {
    await fresh();
    await queue.enqueue({ type: 'identity.account.purge', payload: {} });
    await queue.enqueue({ type: 'test.a', payload: {}, availableAt: new Date(clock.now().getTime() + 60_000) });
    const due = await queue.enqueue({ type: 'test.a', payload: {} });
    expect((await queue.claim(['test.a'], 'w'))?.id).toBe(due.id);
    expect(await queue.claim(['test.a'], 'w')).toBeNull(); // the other one is not due yet
  });

  test('a worker that lost its lease cannot complete the job', async () => {
    await fresh();
    await queue.enqueue({ type: 'test.a', payload: {}, maxAttempts: 3 });
    const first = (await queue.claim(['test.a'], 'w1'))!;
    clock.advance(600);
    await queue.recoverStale(['test.a'], 300_000); // w1 presumed dead
    const second = (await queue.claim(['test.a'], 'w2'))!;
    expect(second.attempts).toBe(2);
    expect(await queue.complete(first)).toBe(false); // fenced out
    expect(await queue.complete(second)).toBe(true);
    expect((await queue.find(second.id))?.status).toBe('COMPLETED');
  });
});

describe('failures', () => {
  test('retryable failures back off, then fail for good after the last attempt', async () => {
    await fresh();
    const { id } = await queue.enqueue({ type: 'test.a', payload: {}, maxAttempts: 2 });
    const a1 = (await queue.claim(['test.a'], 'w'))!;
    expect(await queue.fail(a1, 'transient', true)).toBe('PENDING');
    const row = (await queue.find(id))!;
    expect(row.availableAt.getTime()).toBe(clock.now().getTime() + backoffMs(1));
    expect(await queue.claim(['test.a'], 'w')).toBeNull(); // backing off
    clock.advance(backoffMs(1) / 1000);
    const a2 = (await queue.claim(['test.a'], 'w'))!;
    expect(await queue.fail(a2, 'transient again', true)).toBe('FAILED');
    expect(await queue.find(id)).toMatchObject({ status: 'FAILED', attempts: 2, lastError: 'transient again' });
  });

  test('permanent failures are not retried', async () => {
    await fresh();
    const { id } = await queue.enqueue({ type: 'test.a', payload: {}, maxAttempts: 5 });
    expect(await queue.fail((await queue.claim(['test.a'], 'w'))!, 'bad input', false)).toBe('FAILED');
    expect((await queue.find(id))?.attempts).toBe(1);
  });

  test('crashed workers: stale jobs are re-queued, or failed when out of attempts', async () => {
    await fresh();
    const retry = await queue.enqueue({ type: 'test.a', payload: {}, maxAttempts: 2 });
    const last = await queue.enqueue({ type: 'test.a', payload: {}, maxAttempts: 1 });
    await queue.claim(['test.a'], 'dead');
    await queue.claim(['test.a'], 'dead');
    clock.advance(60);
    expect((await queue.recoverStale(['test.a'], 300_000)).requeued).toBe(0); // lease not expired yet
    clock.advance(600);
    const { requeued, exhausted } = await queue.recoverStale(['test.a'], 300_000);
    expect(requeued).toBe(1);
    expect(exhausted.map(j => j.id)).toEqual([last.id]);
    expect((await queue.find(retry.id))?.status).toBe('PENDING');
  });

  test('pending jobs can be cancelled; running ones are left to their handler', async () => {
    await fresh();
    const pending = await queue.enqueue({ type: 'test.a', payload: {} });
    expect(await queue.cancelPending(pending.id)).toBe(true);
    expect(await queue.claim(['test.a'], 'w')).toBeNull();
    const running = await queue.enqueue({ type: 'test.a', payload: {} });
    await queue.claim(['test.a'], 'w');
    expect(await queue.cancelPending(running.id)).toBe(false);
  });
});

describe('runner', () => {
  test('runs handlers, retries retryable errors and reports permanent failures', async () => {
    await fresh();
    const seen: string[] = [], failed: string[] = [];
    let calls = 0;
    const handler: JobHandler = {
      type: 'test.r',
      async handle(job) {
        calls++;
        if ((job.payload as { kind: string }).kind === 'flaky' && calls === 1) throw new RetryableJobError('try again');
        if ((job.payload as { kind: string }).kind === 'broken') throw new Error('broken');
        seen.push((job.payload as { kind: string }).kind);
        return 'COMPLETED';
      },
      async onFailed(job, error) { failed.push(`${(job.payload as { kind: string }).kind}:${error}`); },
    };
    const runner = new JobRunner({ queue, handlers: [handler], workerId: 'r', leaseMs: 300_000 });
    const flaky = await queue.enqueue({ type: 'test.r', payload: { kind: 'flaky' } });
    await queue.enqueue({ type: 'test.r', payload: { kind: 'broken' } });
    await queue.enqueue({ type: 'identity.account.purge', payload: {} }); // not this runner's job
    await runner.tick(); // flaky → retry later
    await runner.tick(); // broken → failed
    expect((await queue.find(flaky.id))?.status).toBe('PENDING');
    clock.advance(60);
    await runner.tick(); // flaky succeeds
    expect(seen).toEqual(['flaky']);
    expect(failed).toEqual(['broken:broken']);
    const purge = (await t.db.select().from(backgroundJobs)).find(j => j.jobType === 'identity.account.purge');
    expect(purge?.status).toBe('PENDING');
  });
});
