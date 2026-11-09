// End to end over HTTP: API → background_jobs → runner → sandboxed Resin → Postgres → API.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { backgroundJobs, backtestJobs, backtestResults, backtestTrades } from '../../src/db/schema';
import { QUEUE } from '../../src/modules/backtesting/backtesting.constants';
import type { BacktestEngine } from '../../src/modules/backtesting';
import { EngineError } from '../../src/modules/backtesting/engines/backtest-engine.interface';
import { JobRunner } from '../../src/modules/system/jobs';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';
import { definition, recentWalk, seedCandles, walk } from './fixtures';

type App = Awaited<ReturnType<typeof createTestApp>>;
const runnerFor = (t: App) => new JobRunner({ queue: t.backtesting.queue, handlers: [t.backtesting.jobHandler], workerId: 'test-runner', leaseMs: QUEUE.leaseMs });

async function setup(options: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(options);
  await t.market.catalog.sync('BINANCE');
  const user = await activeUser(t);
  const strategy = (await user.c.post('/api/v1/strategies', { name: 'EMA cross', definition: definition() })).body;
  return { t, user, strategy, runner: runnerFor(t) };
}

let t: App, c: Awaited<ReturnType<typeof activeUser>>['c'], strategyId: string, runner: JobRunner;
beforeAll(async () => {
  ({ t, runner, user: { c }, strategy: { id: strategyId } } = await setup());
  await seedCandles(t, recentWalk(t, 1500));
});
afterAll(() => t.close());

const create = (body: Record<string, unknown> = {}, http = c) => http.post('/api/v1/backtests', { strategyId, ...body });

describe('full workflow', () => {
  let id: string;

  test('creating a backtest queues it without running it in the request', async () => {
    const res = await create();
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'PENDING', strategy: { id: strategyId, version: 1, name: 'EMA cross' }, market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' }, summary: null });
    id = res.body.id;
    const [queued] = await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, 'backtesting.run'));
    expect(queued).toMatchObject({ status: 'PENDING', payload: { backtestJobId: id } });
  });

  test('the worker runs it and stores summary, trades and equity curve', async () => {
    expect(await runner.tick()).toBe(true);
    const res = await c.get(`/api/v1/backtests/${id}`);
    expect(res.body.status).toBe('COMPLETED');
    const s = res.body.summary;
    expect(s.totalTrades).toBeGreaterThan(5);
    expect(s.winningTrades + s.losingTrades + s.breakEvenTrades).toBe(s.totalTrades);
    for (const key of ['grossProfit', 'grossLoss', 'netProfit', 'totalCommission', 'totalReturnPercent', 'maxDrawdown', 'finalEquity', 'unrealizedProfit']) {
      expect(s[key]).toMatch(/^-?\d+(\.\d+)?$/); // exact decimal strings
    }
    expect(Number(s.totalCommission)).toBeGreaterThan(0);
    expect(res.body.dataset).toMatchObject({ candles: 1000, missingCandles: 0, source: 'market_candles', checksum: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const [job] = await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, 'backtesting.run'));
    expect(job?.status).toBe('COMPLETED');
    const [result] = await t.db.select().from(backtestResults).where(eq(backtestResults.backtestJobId, id));
    expect(await t.db.select().from(backtestTrades).where(eq(backtestTrades.backtestResultId, result!.id))).toHaveLength(s.totalTrades);
  });

  test('everything needed to reproduce the run is recorded', async () => {
    const res = (await c.get(`/api/v1/backtests/${id}`)).body;
    expect(res.engine).toEqual({ name: 'resin', version: '0.3.0', revision: 'fa683a0ce81bf54832805f3e386c504c144d451a' });
    expect(res.settings).toEqual({ initialCapital: '10000', commissionPercent: '0.1', slippageTicks: 1, positionSizing: { type: 'percent_of_equity', value: '20' } });
    expect(res.symbol).toEqual({ tickSize: '0.01', lotSize: '0.00001', baseAsset: 'BTC', quoteAsset: 'USDT' });
    expect(res.script.source).toContain('strategy("EMA cross"');
    expect(res.script.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.assumptions.fills).toContain('next candle');
    const [row] = await t.db.select().from(backtestJobs).where(eq(backtestJobs.id, id));
    expect(row).toMatchObject({ initialBalance: '10000.000000000000', feeRate: '0.001000000000', timeframe: '1h' });
    expect(row!.configuration).toMatchObject({ strategy: { versionId: res.strategy.versionId }, range: { expectedCandles: 1000 } });
  });

  test('trades are paginated; fees and P/L add up to the summary exactly', async () => {
    const summary = (await c.get(`/api/v1/backtests/${id}`)).body.summary;
    const page1 = (await c.get(`/api/v1/backtests/${id}/trades?limit=5&offset=0`)).body;
    expect(page1).toMatchObject({ total: summary.totalTrades, limit: 5, offset: 0 });
    expect(page1.trades).toHaveLength(5);
    const page2 = (await c.get(`/api/v1/backtests/${id}/trades?limit=5&offset=5`)).body;
    expect(page2.trades[0].entryTime).toBeGreaterThan(page1.trades[4].entryTime);
    const all = (await c.get(`/api/v1/backtests/${id}/trades?limit=500`)).body.trades as { profit: string; fees: string; side: string; entryPrice: string }[];
    const { dec } = await import('../../src/modules/backtesting/utils/decimal');
    expect(dec.round(dec.sum(all.map(x => x.profit)), 8)).toBe(summary.netProfit);
    const open = dec.sub(summary.totalCommission, dec.round(dec.sum(all.map(x => x.fees)), 8));
    expect(dec.cmp(open, '0')).toBeGreaterThanOrEqual(0); // the only difference is an open position's entry fee
    expect(all.every(x => x.side === 'LONG')).toBe(true);
    // Fills are on the 0.01 tick grid.
    expect(all.every(x => /^\d+(\.\d{1,2})?$/.test(x.entryPrice))).toBe(true);
  });

  test('equity curve is bounded and starts at the initial capital', async () => {
    const res = (await c.get(`/api/v1/backtests/${id}/equity-curve?maxPoints=100`)).body;
    expect(res.initialCapital).toBe('10000');
    expect(res.points.length).toBeLessThanOrEqual(100);
    expect(res.points[0].equity).toBe('10000');
    expect((await c.get(`/api/v1/backtests/${id}/equity-curve?maxPoints=5`)).status).toBe(400);
  });

  test('history lists the user\'s backtests, newest first, with paging', async () => {
    const list = (await c.get('/api/v1/backtests?limit=10')).body;
    expect(list.backtests[0]).toMatchObject({ id, status: 'COMPLETED' });
    expect(list.backtests[0].summary.totalTrades).toBeGreaterThan(0);
    expect((await c.get(`/api/v1/backtests?status=FAILED`)).body.backtests.every((b: { status: string }) => b.status === 'FAILED')).toBe(true);
  });

  test('a finished backtest cannot be cancelled, and is never run twice', async () => {
    expect((await c.post(`/api/v1/backtests/${id}/cancel`)).status).toBe(409);
    const [job] = await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, 'backtesting.run'));
    expect(await t.backtesting.jobHandler.handle(job!, { attempt: 2, maxAttempts: 3, isLastAttempt: false })).toBe('COMPLETED');
    expect(await t.db.select().from(backtestResults).where(eq(backtestResults.backtestJobId, id))).toHaveLength(1);
  });
});

describe('validation', () => {
  test('malformed requests are rejected with field errors', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ strategyId: 'nope' }, 'strategyId'],
      [{ userId: crypto.randomUUID() }, '(body)'], // the user always comes from the session
      [{ settings: { initialCapital: '-5' } }, 'settings.initialCapital'],
      [{ settings: { commissionPercent: '50' } }, 'settings.commissionPercent'],
      [{ settings: { slippageTicks: 1.5 } }, 'settings.slippageTicks'],
      [{ settings: { positionSizing: { type: 'percent_of_equity', value: '150' } } }, 'settings.positionSizing.value'],
      [{ market: { timeframe: '2h' } }, 'market.timeframe'],
      [{ range: { start: 'yesterday' } }, 'range.start'],
    ];
    for (const [body, field] of cases) {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fields)).toContain(field);
    }
  });

  test('ranges: too large, too short, or reversed', async () => {
    const now = t.clock.now().getTime();
    const huge = await create({ range: { start: now - 3 * 365 * 86_400_000 }, market: { timeframe: '1m' } });
    expect([huge.status, huge.body.code]).toEqual([400, 'RANGE_TOO_LARGE']);
    const short = await create({ range: { start: now - 20 * 3_600_000 } });
    expect([short.status, short.body.code]).toEqual([422, 'INSUFFICIENT_DATA']);
    expect((await create({ range: { start: now, end: now - 1000 } })).status).toBe(400);
  });

  test('unknown symbols are 404', async () => {
    expect((await create({ market: { symbol: 'NOPEUSDT' } })).body.code).toBe('UNKNOWN_SYMBOL');
  });
});

describe('ownership', () => {
  test('users cannot see, read or cancel each other\'s backtests or use each other\'s strategies', async () => {
    const mine = (await create()).body.id;
    const other = (await activeUser(t)).c;
    for (const path of [`/api/v1/backtests/${mine}`, `/api/v1/backtests/${mine}/trades`, `/api/v1/backtests/${mine}/equity-curve`]) {
      expect((await other.get(path)).status).toBe(404);
    }
    expect((await other.post(`/api/v1/backtests/${mine}/cancel`)).status).toBe(404);
    expect((await other.get('/api/v1/backtests')).body.backtests).toEqual([]);
    const stolen = await other.post('/api/v1/backtests', { strategyId });
    expect([stolen.status, stolen.body.code]).toEqual([404, 'STRATEGY_NOT_FOUND']);
    await c.post(`/api/v1/backtests/${mine}/cancel`);
  });

  test('only signed-in, phone-verified users', async () => {
    expect((await client(t.app).get('/api/v1/backtests')).status).toBe(401);
    expect((await (await pendingUser(t)).c.get('/api/v1/backtests')).status).toBe(403);
  });
});

describe('data problems found by the worker', () => {
  test('no stored history → the backtest fails with INSUFFICIENT_DATA (after trying to backfill)', async () => {
    const eth = (await c.post('/api/v1/strategies', { name: 'ETH', definition: definition({ market: { exchange: 'BINANCE', symbol: 'ETHUSDT', timeframe: '1h' } }) })).body.id;
    const { id } = (await c.post('/api/v1/backtests', { strategyId: eth })).body;
    t.history.calls = [];
    await runner.tick();
    const res = (await c.get(`/api/v1/backtests/${id}`)).body;
    expect(res).toMatchObject({ status: 'FAILED', error: { code: 'INSUFFICIENT_DATA' } });
    expect(t.history.calls[0]).toMatchObject({ symbol: 'ETHUSDT', timeframe: '1h', stored: 0 });
  });

  test('gaps in stored history → DATA_GAPS', async () => {
    const candles = recentWalk(t, 1200, '1h', 11).filter((_, i) => i < 500 || i > 600);
    await seedCandles(t, candles, '1h', 'SOLUSDT');
    const sol = (await c.post('/api/v1/strategies', { name: 'SOL', definition: definition({ market: { exchange: 'BINANCE', symbol: 'SOLUSDT', timeframe: '1h' } }) })).body.id;
    const { id } = (await c.post('/api/v1/backtests', { strategyId: sol })).body;
    await runner.tick();
    expect((await c.get(`/api/v1/backtests/${id}`)).body).toMatchObject({ status: 'FAILED', error: { code: 'DATA_GAPS' } });
  });
});

describe('cancellation, crashes and retries', () => {
  test('a pending backtest can be cancelled and never runs', async () => {
    const { id } = (await create()).body;
    expect((await c.post(`/api/v1/backtests/${id}/cancel`)).body.status).toBe('CANCELLED');
    expect(await runner.tick()).toBe(false);
    expect(await t.db.select().from(backtestResults).where(eq(backtestResults.backtestJobId, id))).toEqual([]);
  });

  test('a running backtest is stopped mid-run', async () => {
    let started!: () => void;
    const running = new Promise<void>(r => (started = r));
    const hanging: BacktestEngine = {
      identity: { name: 'resin', version: '0.3.0', revision: 'test' },
      run: (_input, opts) => new Promise((_resolve, reject) => {
        started();
        opts?.signal?.addEventListener('abort', () => reject(new EngineError('CANCELLED', 'cancelled')));
      }),
    };
    const s = await setup({ backtestEngine: hanging });
    try {
      await seedCandles(s.t, recentWalk(s.t, 1200));
      const { id } = (await s.user.c.post('/api/v1/backtests', { strategyId: s.strategy.id })).body;
      const tick = s.runner.tick();
      await running;
      expect((await s.user.c.get(`/api/v1/backtests/${id}`)).body.status).toBe('RUNNING');
      expect((await s.user.c.post(`/api/v1/backtests/${id}/cancel`)).body.status).toBe('CANCELLED');
      await tick;
      expect((await s.user.c.get(`/api/v1/backtests/${id}`)).body.status).toBe('CANCELLED');
      const [job] = await s.t.db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, 'backtesting.run'));
      expect(job?.status).toBe('CANCELLED');
      expect(await s.t.db.select().from(backtestResults)).toEqual([]);
    } finally {
      await s.t.close();
    }
  });

  test('a job whose worker crashed is recovered after its lease and completed once', async () => {
    const { id } = (await create()).body;
    const claimed = await t.backtesting.queue.claim(['backtesting.run'], 'crashed-worker');
    expect(claimed?.payload).toEqual({ backtestJobId: id });
    t.clock.advance(QUEUE.leaseMs / 1000 + 1);
    const recovering = runnerFor(t);
    expect(await recovering.tick()).toBe(true);
    const res = (await c.get(`/api/v1/backtests/${id}`)).body;
    expect(res.status).toBe('COMPLETED');
    const [job] = await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.id, claimed!.id));
    expect(job).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    expect(await t.db.select().from(backtestResults).where(eq(backtestResults.backtestJobId, id))).toHaveLength(1);
  });

  test('transient market-data failures are retried with backoff, then succeed', async () => {
    const { id } = (await create()).body;
    t.history.fail = Object.assign(new Error('Binance down'), { name: 'MarketError' });
    await runner.tick();
    const [job] = await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.payload, { backtestJobId: id }));
    expect(job).toMatchObject({ status: 'PENDING', attempts: 1 });
    t.history.fail = null;
    t.clock.advance(60);
    await runner.tick();
    expect((await c.get(`/api/v1/backtests/${id}`)).body.status).toBe('COMPLETED');
  });

  test('…and fail cleanly once attempts run out', async () => {
    const { id } = (await create()).body;
    t.history.fail = Object.assign(new Error('Binance down'), { name: 'MarketError' });
    try {
      for (let i = 0; i < QUEUE.maxAttempts; i++) { await runner.tick(); t.clock.advance(1800); }
    } finally {
      t.history.fail = null;
    }
    expect((await c.get(`/api/v1/backtests/${id}`)).body).toMatchObject({ status: 'FAILED', error: { code: 'MARKET_DATA_UNAVAILABLE' } });
  });

  test('a user may have at most 3 queued or running backtests', async () => {
    const ids = [(await create()).body.id, (await create()).body.id, (await create()).body.id];
    const fourth = await create();
    expect([fourth.status, fourth.body.code]).toEqual([429, 'TOO_MANY_ACTIVE']);
    for (const id of ids) await c.post(`/api/v1/backtests/${id}/cancel`);
  });
});

describe('quick backtest of an unsaved AI draft', () => {
  test('returns a summary with warnings and saves nothing', async () => {
    const before = (await t.db.select().from(backtestJobs)).length;
    const res = await c.post('/api/v1/backtests/preview', { name: 'AI draft', definition: definition() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: false, engine: { name: 'resin' }, market: { symbol: 'BTCUSDT' }, dataset: { candles: expect.any(Number) } });
    expect(res.body.metrics.totalTrades).toBeGreaterThan(0);
    expect((await t.db.select().from(backtestJobs)).length).toBe(before);
  });

  test('zero trades and impossible conditions are warnings, not errors', async () => {
    const never = definition({ entry: { conditions: [{ left: { type: 'RSI', period: 14 }, operator: 'GT', right: { type: 'VALUE', value: 150 } }] } });
    const res = await c.post('/api/v1/backtests/preview', { definition: never });
    expect(res.status).toBe(200);
    expect(res.body.metrics).toMatchObject({ totalTrades: 0, winRatePercent: null, profitFactor: null });
    expect(res.body.warnings.map((w: { code: string }) => w.code)).toEqual(expect.arrayContaining(['IMPOSSIBLE_CONDITION', 'ZERO_TRADES']));
  });

  test('invalid drafts are rejected with field errors', async () => {
    const res = await c.post('/api/v1/backtests/preview', { definition: { ...definition(), direction: 'SIDEWAYS' } });
    expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(Object.keys(res.body.fields).length).toBeGreaterThan(0);
  });
});

test('fixture sanity: walk() stays on the hourly grid', () => {
  const w = walk(3);
  expect(w[1]!.openTime - w[0]!.openTime).toBe(3_600_000);
});
