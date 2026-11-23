import { afterAll, beforeAll, expect, test } from 'bun:test';
import { z } from 'zod';
import { backtestResearchGateway, compactExperimentResult, compactResearchResult, historicalRunSchema, researchExperimentSchema } from '../../src/modules/ai/infrastructure/backtest-research.gateway';
import { createBacktestSchema, previewBacktestSchema } from '../../src/modules/backtesting/backtesting.schemas';
import { QUEUE } from '../../src/modules/backtesting/backtesting.constants';
import { JobRunner } from '../../src/modules/system/jobs';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { definition, recentWalk, seedCandles } from '../backtesting/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: Awaited<ReturnType<typeof activeUser>>;
let other: Awaited<ReturnType<typeof activeUser>>;
let gateway: ReturnType<typeof backtestResearchGateway>;
let history: ReturnType<typeof recentWalk>;
let runner: JobRunner;
let savedRun: string;
const draft = () => ({ name: 'AI historical EMA research', definition: definition() });
const requestedRange = () => ({ start: history[300]!.openTime, end: history[599]!.closeTime + 1 });
const isoRange = () => ({ start: new Date(requestedRange().start).toISOString(), end: new Date(requestedRange().end).toISOString() });

beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  owner = await activeUser(t); other = await activeUser(t);
  history = recentWalk(t, 1600);
  await seedCandles(t, history);
  gateway = backtestResearchGateway({ backtests: t.backtesting.service, experiments: t.backtesting.experiments, strategies: t.strategies.service });
  runner = new JobRunner({ queue: t.backtesting.queue, handlers: [t.backtesting.jobHandler, t.backtesting.experimentJobHandler], workerId: 'ai-research-gateway', leaseMs: QUEUE.leaseMs });
});
afterAll(async () => { await t.backtesting.portfolio.dispose(); await t.close(); });

test('requested historical dates, execution assumptions and capital survive a persisted draft run', async () => {
  const run = await gateway.create(owner.user.id, {
    draft: draft() as any, range: isoRange(),
    settings: { initialCapital: '25000', commissionPercent: '0.05', slippageTicks: 3, positionSizing: { type: 'cash', value: '1000' }, execution: { spreadTicks: 2 } },
    riskStatistics: { periodsPerYear: 8760 },
  });
  savedRun = run.id;
  expect(run.status).toBe('PENDING');
  expect(run.range).toEqual(requestedRange());
  expect(run.settings).toMatchObject({ initialCapital: '25000', commissionPercent: '0.05', slippageTicks: 3, positionSizing: { type: 'cash', value: '1000' } });
  expect(run).not.toHaveProperty('script');
  expect(await runner.tick()).toBe(true);
  const complete = await gateway.get(owner.user.id, run.id);
  expect(complete.status).toBe('COMPLETED');
  expect(complete.summary).toMatchObject({ totalTrades: expect.any(Number), riskStatistics: { observations: 300 } });
  expect(complete.settings?.initialCapital).toBe('25000');
  expect(complete.dataset).toMatchObject({ candles: 300, firstOpenTime: requestedRange().start });
  expect(complete.assumptions).toHaveProperty('intrabarPath');
  const trades = await gateway.trades(owner.user.id, run.id, { limit: 2 });
  expect(trades.trades.length).toBeLessThanOrEqual(2);
  expect(trades.total).toBeGreaterThan(0);
  expect((await gateway.equity(owner.user.id, run.id, { maxPoints: 30 })).points.length).toBeLessThanOrEqual(30);
  const archive = await t.backtesting.service.snapshot(owner.user.id, run.id);
  expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/);
});

test('invalid ranges fail before a new draft strategy is saved', async () => {
  const before = (await gateway.strategies(owner.user.id)).total;
  const now = t.clock.now().getTime();
  for (const range of [{ start: now + 1000, end: now + 2000 }, { start: 0, end: now }, { start: now - 1000, end: now }]) {
    await expect(gateway.create(owner.user.id, { draft: draft() as any, range })).rejects.toThrow();
  }
  expect((await gateway.strategies(owner.user.id)).total).toBe(before);
  for (const schema of [historicalRunSchema, createBacktestSchema]) {
    expect(schema.safeParse({ strategyId: crypto.randomUUID(), range: {}, candles: 100 }).success).toBe(false);
    expect(schema.safeParse({ strategyId: crypto.randomUUID(), range: isoRange(), candles: 100 }).success).toBe(false);
  }
  expect(previewBacktestSchema.safeParse({ definition: definition(), range: { start: '2026-11-01T09:15:00' } }).success).toBe(false);
});

test('saved strategy selection, count-based runs and cancellation remain owner scoped', async () => {
  const page = await gateway.strategies(owner.user.id, { limit: 1 });
  const strategy = await gateway.strategy(owner.user.id, page.items[0]!.id);
  const run = await gateway.create(owner.user.id, { strategyId: strategy.id, strategyVersionId: strategy.versionId, candles: 200 });
  expect(run.range.end - run.range.start).toBeGreaterThanOrEqual(200 * 3600000);
  expect((await gateway.list(owner.user.id, { status: 'PENDING' })).backtests.some(r => r.id === run.id)).toBe(true);
  for (const action of [() => gateway.strategy(other.user.id, strategy.id), () => gateway.get(other.user.id, run.id), () => gateway.cancel(other.user.id, run.id), () => gateway.replay(other.user.id, savedRun)]) await expect(action()).rejects.toThrow();
  expect((await gateway.cancel(owner.user.id, run.id)).status).toBe('CANCELLED');
  await runner.tick();
  const replay = await gateway.replay(owner.user.id, savedRun);
  expect(replay.status).toBe('PENDING');
  expect(replay.range).toEqual(requestedRange());
  await gateway.cancel(owner.user.id, replay.id);
  await runner.tick();
});

test('preview honors explicit historical dates and timeframe overrides', async () => {
  const response = await owner.c.post('/api/v1/backtests/preview', { name: 'Dated preview', definition: definition({ market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1d' } }),
    market: { timeframe: '1h' }, range: isoRange(), settings: { initialCapital: '12345', commissionPercent: '0', slippageTicks: 0 } });
  expect(response.status).toBe(200);
  expect(response.body.market.timeframe).toBe('1h');
  expect(response.body.range).toEqual(requestedRange());
  expect(response.body.settings.initialCapital).toBe('12345');
  expect(response.body.dataset.candles).toBe(300);
  expect((await owner.c.post('/api/v1/backtests/preview', { definition: definition(), range: { end: t.clock.now().getTime() + 1000 } })).status).toBe(400);
});

test('dataset discovery returns observed coverage without exposing the full historical payload', async () => {
  const dataset = await gateway.importDataset(owner.user.id, {
    schemaVersion: 1, name: 'AI imported historical fixture',
    provenance: { source: 'Deterministic software fixture', license: 'test', importedAt: t.clock.now().getTime(), adjustment: 'raw' },
    instruments: [{ id: 'btc', exchange: 'BINANCE', symbol: 'BTCUSDT', assetClass: 'crypto', currency: 'USDT', tickSize: '0.01', lotSize: '0.00001', listedAt: 0 }],
    candles: history.map(c => ({ ...c, instrumentId: 'btc', timeframe: '1h' })),
  });
  expect((await gateway.datasets(owner.user.id)).datasets[0]).toMatchObject({ id: dataset.id, candleCount: 1600 });
  const meta = await gateway.dataset(owner.user.id, dataset.id);
  expect(meta.data).toMatchObject({ instrumentTotal: 1, instruments: [{ id: 'btc', quotes: null, margins: null, candleRanges: [{ candles: 1600, start: history[0]!.openTime, end: history.at(-1)!.closeTime + 1 }] }] });
  expect(JSON.stringify(meta)).not.toContain('"open":');
  await expect(gateway.dataset(other.user.id, dataset.id)).rejects.toThrow('Dataset not found');
  const experiment = await gateway.createExperiment(owner.user.id, { kind: 'single', datasetId: dataset.id, instrumentId: 'btc', timeframe: '1h', range: isoRange(), definitions: [definition() as any] });
  await runner.tick();
  const result = await gateway.getExperiment(owner.user.id, experiment.id);
  expect(result.status).toBe('COMPLETED');
  expect(result.result?.data).toMatchObject({ kind: 'single', metrics: { range: requestedRange(), totalTrades: expect.any(Number) } });
  expect((await gateway.listExperiments(owner.user.id)).experiments.some(e => e.id === experiment.id)).toBe(true);
  await expect(gateway.getExperiment(other.user.id, experiment.id)).rejects.toThrow('Experiment not found');
  const pending = await gateway.createExperiment(owner.user.id, { kind: 'single', datasetId: dataset.id, instrumentId: 'btc', timeframe: '1h', range: isoRange(), definitions: [definition() as any] });
  expect((await gateway.cancelExperiment(owner.user.id, pending.id)).status).toBe('CANCELLED');
});

test('research schema accepts offset timestamps but retains quote chronology validation', () => {
  const range = { start: '2026-11-20T09:15:00+05:30', end: '2026-11-20T09:16:00+05:30' };
  const request = { kind: 'options', datasetId: crypto.randomUUID(), execution: { ...range, initialCapital: '1000', orders: [{ id: 'one', time: '2026-11-20T09:15:01+05:30', legs: [{ instrumentId: 'btc', side: 'BUY', lots: 1 }] }] } };
  const parsed = researchExperimentSchema.parse(request);
  expect(parsed.kind).toBe('options');
  if (parsed.kind !== 'options') throw new Error('Wrong variant');
  expect(parsed.execution.start).toBe(Date.parse(range.start));
  expect(parsed.execution.orders[0]!.time).toBe(Date.parse('2026-11-20T03:45:01Z'));
  expect(researchExperimentSchema.safeParse({ ...request, execution: { ...request.execution, end: range.start } }).success).toBe(false);
  expect(() => z.toJSONSchema(researchExperimentSchema, { io: 'input', target: 'draft-7' })).not.toThrow();
});

test('large experiment summaries are bounded and label omitted rows without changing totals', () => {
  const result = compactResearchResult({ totalTrades: 10000, warnings: ['Synthetic stress result'], trades: Array.from({ length: 10000 }, (_, id) => ({ id, note: '\u0001'.repeat(2000), profit: '1' })), finalEquity: '110000' });
  expect(result.truncated).toBe(true);
  expect(result.data).toMatchObject({ totalTrades: 10000, tradesTotal: 10000 });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(49000);
  expect(result.notice).toContain('bounded preview');
});

test('direct AI imports enforce the same document-size limit as HTTP imports', async () => {
  await expect(gateway.importDataset(owner.user.id, { oversized: 'x'.repeat(16 * 1024 * 1024) })).rejects.toThrow('16 MiB');
});

test('all ten OOS scores survive eight-candidate training reports with large diagnostic curves', () => {
  const metrics = { totalReturnPercent: '1.25', netProfit: '125', maxDrawdownPercent: '2.5', intrabarMaxDrawdownPercent: '3.1', winRatePercent: '55', totalTrades: 500,
    profitFactor: '1.2', finalEquity: '10125', settings: { initialCapital: '10000', commissionPercent: '0.1', slippageTicks: 1, positionSizing: { type: 'percent_of_equity', value: '20' } },
    trades: Array.from({ length: 500 }, (_, id) => ({ id, notes: 'diagnostic detail'.repeat(80) })), equityCurve: Array.from({ length: 500 }, (_, time) => ({ time, equity: '10000' })) };
  const windows = Array.from({ length: 10 }, (_, id) => ({ window: { id, trainStart: id * 100, trainEnd: id * 100 + 200, testStart: id * 100 + 201, testEnd: id * 100 + 251 },
    selectedCandidate: id % 8, trainRange: { start: id * 100, end: id * 100 + 200 }, testRange: { start: id * 100 + 201, end: id * 100 + 251 },
    training: Array.from({ length: 8 }, (_, candidateIndex) => ({ candidateIndex, score: 20 + candidateIndex, metrics })), outOfSample: { score: id / 100, metrics } }));
  const report = compactExperimentResult({ kind: 'walk_forward', windows, evaluatedCandidates: 8, warnings: ['Out-of-sample warning'],
    sensitivity: { minimumScore: 20, maximumScore: 27, medianScore: 23.5, results: windows[0]!.training.map(c => ({ index: c.candidateIndex, score: c.score, metrics })) } }, Array.from({ length: 8 }, () => definition()));
  const data = report.data as any;
  expect(data.windows).toHaveLength(10);
  expect(data.windows.map((w: any) => w.outOfSample.score)).toEqual(windows.map(w => w.outOfSample.score));
  expect(data.windows[9].training).toHaveLength(8);
  expect(data.windows[9].outOfSample.settings.initialCapital).toBe('10000');
  expect(data.sensitivity.results).toHaveLength(8);
  expect(data.candidates).toHaveLength(8);
  expect(data.candidates[7].entryConditions[0]).toBe('EMA(10) crosses above EMA(30)');
  expect(JSON.stringify(report)).not.toContain('diagnostic detail');
  expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(24000);
});
