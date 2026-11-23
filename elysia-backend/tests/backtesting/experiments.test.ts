import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { backtestDatasets } from '../../src/db/schema';
import { JobRunner } from '../../src/modules/system/jobs';
import { QUEUE } from '../../src/modules/backtesting/backtesting.constants';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { definition, walk } from './fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let c: Awaited<ReturnType<typeof activeUser>>['c'];
let datasetId: string;
let runner: JobRunner;
const history = walk(800);
const dataset = {
  schemaVersion: 1, name: 'Synthetic research fixture',
  provenance: { source: 'Deterministic test fixture', license: 'test', importedAt: 1_790_000_000_000, adjustment: 'raw' },
  instruments: [{ id: 'btc', exchange: 'BINANCE', symbol: 'BTCUSDT', assetClass: 'crypto', currency: 'USDT', tickSize: '0.01', lotSize: '0.00001', listedAt: 0 }],
  candles: history.map(candle => ({ ...candle, instrumentId: 'btc', timeframe: '1h' })),
};
beforeAll(async () => {
  t = await createTestApp();
  ({ c } = await activeUser(t));
  const response = await c.post('/api/v1/backtests/datasets', dataset);
  expect(response.status).toBe(201);
  datasetId = response.body.id;
  runner = new JobRunner({ queue: t.backtesting.queue, handlers: [t.backtesting.experimentJobHandler], workerId: 'research-tests', leaseMs: QUEUE.leaseMs });
});
afterAll(async () => { await t.backtesting.portfolio.dispose(); await t.close(); });

const request = () => ({ datasetId, kind: 'single', instrumentId: 'btc', timeframe: '1h',
  range: { start: history[200]!.openTime, end: history[599]!.closeTime + 1 }, definitions: [definition()] });

test('validated imports provide compact metadata and reject duplicate event data', async () => {
  const list = (await c.get('/api/v1/backtests/datasets')).body.datasets;
  expect(list[0]).toMatchObject({ id: datasetId, candleCount: 800, quoteCount: 0 });
  expect(list[0].ranges[0]).toMatchObject({ instrumentId: 'btc', timeframe: '1h', candles: 800 });
  expect(list[0].payload).toBeUndefined();
  const invalid = await c.post('/api/v1/backtests/datasets', { ...dataset, candles: [...dataset.candles, dataset.candles[0]] });
  expect(invalid.status).toBe(400);
});

test('single imported research runs through the real sandbox and retains dataset identity', async () => {
  const queued = await c.post('/api/v1/backtests/experiments', request());
  expect(queued.status).toBe(202);
  expect(await runner.tick()).toBe(true);
  const result = (await c.get(`/api/v1/backtests/experiments/${queued.body.id}`)).body;
  expect(result.status).toBe('COMPLETED');
  expect(result.result.metrics.range).toEqual(request().range);
  expect(result.result.metrics.totalTrades).toBeGreaterThan(0);
  expect(result.result.datasetChecksum).toMatch(/^[a-f0-9]{64}$/);
});

test('walk-forward keeps training selection separate from later test results', async () => {
  const queued = await c.post('/api/v1/backtests/experiments', {
    ...request(), kind: 'walk_forward', definitions: [definition(), definition({ risk: { positionSizePercent: 10 } })],
    walkForward: { trainBars: 150, testBars: 50, embargoBars: 1, stepBars: 100 },
  });
  expect(queued.status).toBe(202);
  await runner.tick();
  const result = (await c.get(`/api/v1/backtests/experiments/${queued.body.id}`)).body;
  expect(result.status).toBe('COMPLETED');
  expect(result.result.objective).toBe('total_return');
  expect(result.result.windows).toHaveLength(2);
  for (const window of result.result.windows) {
    expect(window.trainRange.end).toBeLessThan(window.testRange.start);
    expect(window.training).toHaveLength(2);
    expect(window.outOfSample.metrics.range).toEqual(window.testRange);
  }
  expect(result.result.sensitivity.results).toHaveLength(2);
});

test('datasets and experiments are owned, immutable and cancellable', async () => {
  const other = await activeUser(t);
  expect((await other.c.get(`/api/v1/backtests/datasets/${datasetId}`)).status).toBe(404);
  expect((await other.c.post('/api/v1/backtests/experiments', request())).status).toBe(404);
  await expect(Promise.resolve(t.db.update(backtestDatasets).set({ name: 'mutated' }).where(eq(backtestDatasets.id, datasetId)))).rejects.toThrow();
  const queued = await c.post('/api/v1/backtests/experiments', request());
  expect((await other.c.get(`/api/v1/backtests/experiments/${queued.body.id}`)).status).toBe(404);
  expect((await c.post(`/api/v1/backtests/experiments/${queued.body.id}/cancel`)).body.status).toBe('CANCELLED');
  await runner.tick();
  expect((await c.get(`/api/v1/backtests/experiments/${queued.body.id}`)).body.status).toBe('CANCELLED');
});

test('quote portfolio execution is isolated and charges supplied historical costs', async () => {
  const start = history[0]!.openTime;
  const imported = await c.post('/api/v1/backtests/datasets', {
    ...dataset, candles: [],
    quotes: [
      { instrumentId: 'btc', eventId: 'q1', time: start, receivedAt: start, bid: '99', ask: '100', bidSize: '10', askSize: '10' },
      { instrumentId: 'btc', eventId: 'q2', time: start + 1000, receivedAt: start + 1000, bid: '110', ask: '111', bidSize: '10', askSize: '10' },
    ],
    feeSchedules: [{ id: 'test-fees', source: 'test fixture', exchange: 'BINANCE', assetClass: 'crypto', validFrom: start, validTo: start + 5000,
      components: [{ name: 'commission', basis: 'turnover', ratePercent: '0.1' }] }],
  });
  expect(imported.status).toBe(201);
  const queued = await c.post('/api/v1/backtests/experiments', { kind: 'options', datasetId: imported.body.id,
    execution: { start, end: start + 2000, initialCapital: '1000', orders: [
      { id: 'buy', time: start + 1, legs: [{ instrumentId: 'btc', side: 'BUY', lots: 100000 }] },
      { id: 'sell', time: start + 1001, legs: [{ instrumentId: 'btc', side: 'SELL', lots: 100000 }] },
    ] } });
  expect(queued.status).toBe(202);
  await runner.tick();
  const run = (await c.get(`/api/v1/backtests/experiments/${queued.body.id}`)).body;
  expect(run.status).toBe('COMPLETED');
  expect(run.result.finalEquity).toBe('1009.79');
});

test('ratio objectives require explicit annual sampling before an experiment is queued', async () => {
  const before = (await c.get('/api/v1/backtests/experiments')).body.experiments.length;
  for (const objective of ['sharpe', 'sortino']) {
    const response = await c.post('/api/v1/backtests/experiments', { ...request(), kind: 'walk_forward', objective,
      walkForward: { trainBars: 150, testBars: 50, embargoBars: 1, stepBars: 100 } });
    expect(response.status).toBe(422);
    expect(response.body.error).toContain('riskStatistics.periodsPerYear');
  }
  expect((await c.get('/api/v1/backtests/experiments')).body.experiments.length).toBe(before);
});

test('a ratio that remains undefined during real evaluation fails with its objective reason', async () => {
  const never = definition({ entry: { conditions: [{ left: { type: 'PRICE' }, operator: 'LT', right: { type: 'VALUE', value: 0 } }] } });
  const response = await c.post('/api/v1/backtests/experiments', { ...request(), kind: 'walk_forward', objective: 'sharpe', definitions: [never],
    riskStatistics: { periodsPerYear: 8760 }, walkForward: { trainBars: 150, testBars: 50, embargoBars: 1, stepBars: 100 } });
  expect(response.status).toBe(202);
  await runner.tick();
  const result = (await c.get(`/api/v1/backtests/experiments/${response.body.id}`)).body;
  expect(result.status).toBe('FAILED');
  expect(result.error).toContain('sharpe objective is undefined');
});

test('min_drawdown uses a negative ranking utility while preserving actual drawdown metrics', async () => {
  const response = await c.post('/api/v1/backtests/experiments', { ...request(), kind: 'walk_forward', objective: 'min_drawdown',
    definitions: [definition(), definition({ risk: { positionSizePercent: 10 } })], walkForward: { trainBars: 150, testBars: 50, embargoBars: 1, stepBars: 100 } });
  expect(response.status).toBe(202);
  await runner.tick();
  const result = (await c.get(`/api/v1/backtests/experiments/${response.body.id}`)).body;
  expect(result.status).toBe('COMPLETED');
  expect(result.result.objective).toBe('min_drawdown');
  expect(result.result.selectionObjective).toContain('rankingScore is its negative');
  for (const window of result.result.windows) for (const candidate of window.training) {
    expect(candidate.rankingScore).toBe(-Number(candidate.metrics.maxDrawdownPercent));
    expect(candidate.objectiveValue).toBe(Number(candidate.metrics.maxDrawdownPercent));
    expect(candidate.objectiveValue).toBeGreaterThanOrEqual(0);
  }
});
