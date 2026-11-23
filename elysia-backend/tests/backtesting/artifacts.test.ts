import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { backtestSnapshots, marketCandles } from '../../src/db/schema';
import { QUEUE } from '../../src/modules/backtesting/backtesting.constants';
import { JobRunner } from '../../src/modules/system/jobs';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { definition, recentWalk, seedCandles } from './fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let c: Awaited<ReturnType<typeof activeUser>>['c'];
let id: string;
let runner: JobRunner;
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  ({ c } = await activeUser(t));
  await seedCandles(t, recentWalk(t, 1600));
  const strategy = (await c.post('/api/v1/strategies', { name: 'Archived EMA cross', definition: definition() })).body;
  id = (await c.post('/api/v1/backtests', { strategyId: strategy.id, riskStatistics: { periodsPerYear: 8760, annualRiskFreeRate: 0 } })).body.id;
  runner = new JobRunner({ queue: t.backtesting.queue, handlers: [t.backtesting.jobHandler], workerId: 'artifacts', leaseMs: QUEUE.leaseMs });
  await runner.tick();
});
afterAll(() => t.close());

test('archives pre-start candles, but reports only the selected period', async () => {
  const result = (await c.get(`/api/v1/backtests/${id}`)).body;
  expect(result.status).toBe('COMPLETED');
  expect(result.summary.riskStatistics.observations).toBe(1000);
  expect(result.summary.riskStatistics.assumptions.periodsPerYear).toBe(8760);
  const snapshot = (await c.get(`/api/v1/backtests/${id}/dataset`)).body;
  expect(snapshot.input.candles.length).toBeGreaterThan(result.dataset.candles);
  expect(snapshot.input.tradingStartTime).toBe(result.range.start);
  expect(snapshot.input.candles[0].openTime).toBeLessThan(result.range.start);
  const trades = (await c.get(`/api/v1/backtests/${id}/trades?limit=500`)).body.trades;
  expect(trades.every((trade: { entryTime: number }) => trade.entryTime >= result.range.start)).toBe(true);
});

test('replay uses archived inputs after shared history is removed', async () => {
  const original = (await c.get(`/api/v1/backtests/${id}`)).body;
  const originalInput = (await c.get(`/api/v1/backtests/${id}/dataset`)).body;
  await t.db.delete(marketCandles);
  const historyCalls = t.history.calls.length;
  const replay = await c.post(`/api/v1/backtests/${id}/replay`);
  expect(replay.status).toBe(202);
  await runner.tick();
  const result = (await c.get(`/api/v1/backtests/${replay.body.id}`)).body;
  expect(result.status).toBe('COMPLETED');
  expect(result.summary.netProfit).toBe(original.summary.netProfit);
  expect(result.summary.totalTrades).toBe(original.summary.totalTrades);
  expect(t.history.calls.length).toBe(historyCalls);
  const archived = (await c.get(`/api/v1/backtests/${replay.body.id}/dataset`)).body;
  expect(archived.checksum).toBe(originalInput.checksum);
  expect(archived.input).toEqual(originalInput.input);
});

test('snapshots cannot be modified and are private to the run owner', async () => {
  await expect(Promise.resolve(t.db.update(backtestSnapshots).set({ checksum: '0'.repeat(64) }).where(eq(backtestSnapshots.backtestJobId, id)))).rejects.toThrow();
  const another = await activeUser(t);
  expect((await another.c.get(`/api/v1/backtests/${id}/dataset`)).status).toBe(404);
  expect((await another.c.post(`/api/v1/backtests/${id}/replay`)).status).toBe(404);
});
