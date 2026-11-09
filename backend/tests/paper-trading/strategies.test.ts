import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { backgroundJobs, marketCandles, paperOrders, paperSignals, paperStrategyInstances, strategyVersions, tradingSymbols } from '../../src/db/schema';
import { EngineError } from '../../src/modules/backtesting';
import { ResinEngine } from '../../src/modules/backtesting/engines/resin/resin.engine';
import { createPaperTradingModule } from '../../src/modules/paper-trading';
import { latestClosedOpenTime } from '../../src/modules/paper-trading/strategies/strategy-runner.service';
import { silentLogger } from '../../src/logger';
import { activeUser } from '../helpers/users';
import { definition, ScriptedSignals, seedClosedHistory, setup, tick, type App, type Http } from './fixtures';
import { engineInput, walk } from '../backtesting/fixtures';

const H = 3_600_000;
const scripted = new ScriptedSignals();
let t: App, c: Http, accountId: string, strategyId: string;

beforeAll(async () => {
  ({ t, c, account: { id: accountId } } = await setup({ signalEngine: scripted }));
  strategyId = (await c.post('/api/v1/strategies', { name: 'EMA cross', definition: definition({ exit: { conditions: [{ left: { type: 'EMA', period: 10 }, operator: 'CROSSES_BELOW', right: { type: 'EMA', period: 30 } }], stopLossPercent: 5, takeProfitPercent: 10 } }) })).body.id;
  await seedClosedHistory(t, 600);
});
afterAll(() => t.close());

const runner = () => t.paperTrading.services.strategies;
const instance = async (id: string) => (await t.db.select().from(paperStrategyInstances).where(eq(paperStrategyInstances.id, id)))[0]!;
const signalsOf = async (id: string) => t.db.select().from(paperSignals).where(eq(paperSignals.strategyInstanceId, id)).orderBy(paperSignals.candleOpenTime);
/** Moves the clock one hour and stores the candle that just closed. */
async function nextHour(symbol = 'BTCUSDT', store = true) {
  t.clock.advance(3600);
  const latest = latestClosedOpenTime('1h', t.clock.now().getTime());
  if (store) {
    const [s] = await t.db.select().from(tradingSymbols).where(eq(tradingSymbols.symbol, symbol));
    await t.db.insert(marketCandles).values({ symbolId: s!.id, timeframe: '1h', openTime: latest, closeTime: latest + H - 1, open: '70000', high: '70100', low: '69900', close: '70050', volume: '1', isClosed: true }).onConflictDoNothing();
  }
  tick(t, symbol, '70050', { bid: '70050', ask: '70050' });
  return latest;
}

describe('lifecycle', () => {
  let id: string;

  test('start creates the instance with its exact version and queues its first evaluation', async () => {
    const res = await c.post(`/api/v1/paper/strategies/${strategyId}/start`, { accountId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CREATED', symbol: 'BTCUSDT', timeframe: '1h', positionSizing: { type: 'percent_of_equity', value: '20' }, execution: { commissionPercent: '0.1', slippageBps: 5 }, protective: { stopLossPercent: 5, takeProfitPercent: 10 } });
    id = res.body.id;
    const jobs = await t.db.select().from(backgroundJobs).where(and(eq(backgroundJobs.jobType, 'paper.strategy.evaluate'), eq(backgroundJobs.dedupeKey, id)));
    expect(jobs).toHaveLength(1);
    // Enqueuing again while one is pending collapses into the same job.
    await runner().schedule(id);
    expect(await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.dedupeKey, id))).toHaveLength(1);
  });

  test('the first evaluation starts it from the next candle (history is never traded)', async () => {
    scripted.entries.add(latestClosedOpenTime('1h', t.clock.now().getTime())); // a signal on an already-closed candle
    await runner().evaluate(id);
    const i = await instance(id);
    expect(i.status).toBe('RUNNING');
    expect(i.lastProcessedCandleTime).toBe(latestClosedOpenTime('1h', t.clock.now().getTime()));
    expect(await signalsOf(id)).toEqual([]);
  });

  test('a completed candle with an entry signal opens a position with stop loss and take profit', async () => {
    const candle = await nextHour();
    scripted.entries.add(candle);
    const r = await runner().evaluate(id);
    expect(r.processed).toBe(1);
    const [signal] = await signalsOf(id);
    expect(signal).toMatchObject({ candleOpenTime: candle, action: 'ENTER_LONG', status: 'EXECUTED' });
    const orders = await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, id));
    const entry = orders.find(o => o.source === 'STRATEGY')!;
    expect(entry).toMatchObject({ status: 'FILLED', side: 'BUY', idempotencyKey: `signal:${signal!.id}` });
    const protective = orders.filter(o => o.source === 'PROTECTIVE');
    expect(protective.map(o => [o.orderType, o.status, o.reduceOnly]).sort()).toEqual([['LIMIT', 'OPEN', true], ['STOP_MARKET', 'OPEN', true]]);
    expect(new Set(protective.map(o => o.ocoGroup)).size).toBe(1);
    // Sized at 20% of cash: 2000 / 70050 → floored to the 0.00001 lot.
    expect(entry.quantity).toBe('0.028550000000');
    expect(scripted.calls.at(-1)).toMatchObject({ bars: 1, last: candle });
  });

  test('evaluating the same candle again does nothing; reprocessing the signal creates no second order', async () => {
    expect(await runner().evaluate(id)).toEqual({ processed: 0, signal: null });
    const [signal] = await signalsOf(id);
    const before = (await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, id))).length;
    await t.paperTrading.services.signalProcessor.process(signal!, await instance(id), (await instance(id)).configuration as never);
    expect((await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, id))).length).toBe(before);
    expect(t.paperTrading.services.signalProcessor.metrics.duplicatesPrevented).toBeGreaterThan(0);
  });

  test('unfinished candles are never evaluated', async () => {
    const current = latestClosedOpenTime('1h', t.clock.now().getTime()) + H; // still forming
    const [s] = await t.db.select().from(tradingSymbols).where(eq(tradingSymbols.symbol, 'BTCUSDT'));
    await t.db.insert(marketCandles).values({ symbolId: s!.id, timeframe: '1h', openTime: current, closeTime: current + H - 1, open: '1', high: '1', low: '1', close: '1', volume: '1', isClosed: false }).onConflictDoNothing();
    scripted.exits.add(current);
    const calls = scripted.calls.length;
    expect((await runner().evaluate(id)).processed).toBe(0);
    expect(scripted.calls.length).toBe(calls); // not even evaluated
    await t.db.delete(marketCandles).where(and(eq(marketCandles.symbolId, s!.id), eq(marketCandles.openTime, current)));
  });

  test('an exit signal closes the position and its protective orders are cancelled', async () => {
    const candle = await nextHour();
    scripted.exits.add(candle);
    await runner().evaluate(id);
    expect((await signalsOf(id)).at(-1)).toMatchObject({ action: 'EXIT_LONG', status: 'EXECUTED' });
    const orders = await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, id));
    expect(orders.filter(o => o.source === 'PROTECTIVE').every(o => o.status === 'CANCELLED')).toBe(true);
    expect((await c.get(`/api/v1/paper/positions?accountId=${accountId}&status=OPEN`)).body.positions).toEqual([]);
  });

  test('after missed candles only the newest is traded; older signals are recorded as skipped', async () => {
    const a = await nextHour(); const b = await nextHour(); const latest = await nextHour();
    scripted.entries.add(a); scripted.entries.add(latest);
    void b;
    const r = await runner().evaluate(id);
    expect(r.processed).toBe(3);
    const recent = (await signalsOf(id)).slice(-2);
    expect(recent.map(s => [s.candleOpenTime, s.action, s.status])).toEqual([[a, 'ENTER_LONG', 'SKIPPED'], [latest, 'ENTER_LONG', 'EXECUTED']]);
    expect(scripted.calls.at(-1)!.bars).toBe(3); // one sandboxed run for all three candles
  });

  test('missed candles that never reached Postgres are recovered over REST', async () => {
    const candle = await nextHour('BTCUSDT', false); // not stored: as if the stream dropped it
    t.provider.candles = [{ openTime: candle, closeTime: candle + H - 1, open: '70000', high: '70100', low: '69900', close: '70000', volume: '1', quoteVolume: '1', trades: 1, isClosed: true }];
    const before = t.paperTrading.services.evaluator.metrics.recoveries;
    await runner().evaluate(id);
    expect(t.paperTrading.services.evaluator.metrics.recoveries).toBe(before + 1);
    expect((await instance(id)).lastProcessedCandleTime).toBe(candle);
  });

  test('pause stops trading; resume continues from the latest candle without trading the pause', async () => {
    expect((await c.post(`/api/v1/paper/strategies/${id}/pause`)).body.status).toBe('PAUSED');
    const during = await nextHour();
    scripted.exits.add(during);
    expect((await runner().evaluate(id)).processed).toBe(0);
    expect((await c.post(`/api/v1/paper/strategies/${id}/pause`)).body.code).toBe('INVALID_TRANSITION');
    const resumed = (await c.post(`/api/v1/paper/strategies/${id}/resume`)).body;
    expect(resumed).toMatchObject({ status: 'RUNNING', lastProcessedCandleTime: during });
    expect((await signalsOf(id)).some(s => s.candleOpenTime === during)).toBe(false);
  });

  test('a running strategy keeps its version when a newer one is saved', async () => {
    const before = await instance(id);
    await t.db.insert(strategyVersions).values({ strategyId, version: 2, definition: { ...(await t.db.select().from(strategyVersions).where(eq(strategyVersions.id, before.strategyVersionId)))[0]!.definition }, riskSettings: { positionSizePercent: 50 }, engineVersion: 'v1' });
    await nextHour();
    await runner().evaluate(id);
    const after = await instance(id);
    expect(after.strategyVersionId).toBe(before.strategyVersionId);
    expect((after.configuration as { script: { sha256: string } }).script.sha256).toBe((before.configuration as { script: { sha256: string } }).script.sha256);
  });

  test('one live strategy per account and symbol; stop (optionally closing the position) frees the slot', async () => {
    expect((await c.post(`/api/v1/paper/strategies/${strategyId}/start`, { accountId })).body.code).toBe('STRATEGY_CONFLICT');
    expect((await c.get(`/api/v1/paper/positions?accountId=${accountId}&status=OPEN`)).body.positions).toHaveLength(1);
    const stopped = (await c.post(`/api/v1/paper/strategies/${id}/stop`, { closePosition: true })).body;
    expect(stopped.status).toBe('STOPPED');
    expect((await c.get(`/api/v1/paper/positions?accountId=${accountId}&status=OPEN`)).body.positions).toEqual([]);
    expect((await c.post(`/api/v1/paper/strategies/${id}/resume`)).body.code).toBe('INVALID_TRANSITION');
    const again = await c.post(`/api/v1/paper/strategies/${strategyId}/start`, { accountId });
    expect(again.status).toBe(201);
    expect(again.body.strategyVersionId).not.toBe(stopped.strategyVersionId); // a new start takes the latest version
    await c.post(`/api/v1/paper/strategies/${again.body.id}/stop`, {});
  });
});

describe('recovery and failures', () => {
  test('a restarted process resumes from the persisted candle and finishes a signal left behind', async () => {
    const id = (await c.post(`/api/v1/paper/strategies/${strategyId}/start`, { accountId })).body.id;
    await runner().evaluate(id); // CREATED → RUNNING
    const candle = await nextHour();
    // Simulate a crash right after the signal was committed but before its order was placed.
    await t.db.insert(paperSignals).values({ strategyInstanceId: id, candleOpenTime: candle, action: 'ENTER_LONG', status: 'GENERATED' });
    await t.db.update(paperStrategyInstances).set({ lastProcessedCandleTime: candle }).where(eq(paperStrategyInstances.id, id));
    // A brand-new module instance (fresh memory) against the same database.
    const restarted = createPaperTradingModule({ db: t.appDb, requireActiveUser: t.identity.requireActiveUser, market: { service: t.market.service, hub: t.market.hub }, signals: scripted, queue: t.backtesting.queue, clock: t.clock, log: silentLogger });
    // The new process has no streamed prices yet; it gets one (in production: the stream or REST).
    t.clock.advance(1);
    restarted.services.quotes.observe('BINANCE', { exchange: 'BINANCE', symbol: 'BTCUSDT', lastPrice: '70050', priceChange: '0', priceChangePercent: '0', openPrice: '70050', highPrice: '70050', lowPrice: '70050', volume: '1', quoteVolume: '1', bidPrice: '70050', askPrice: '70050', time: t.clock.now().getTime() });
    await restarted.services.strategies.evaluate(id);
    const [s] = await t.db.select().from(paperSignals).where(and(eq(paperSignals.strategyInstanceId, id), eq(paperSignals.candleOpenTime, candle)));
    expect(s).toMatchObject({ status: 'EXECUTED' });
    expect(await t.db.select().from(paperOrders).where(eq(paperOrders.idempotencyKey, `signal:${s!.id}`))).toHaveLength(1);
    await c.post(`/api/v1/paper/strategies/${id}/stop`, { closePosition: true });
  });

  test('an engine error that cannot be retried marks the instance FAILED', async () => {
    const id = (await c.post(`/api/v1/paper/strategies/${strategyId}/start`, { accountId })).body.id;
    await runner().evaluate(id);
    await nextHour();
    const original = scripted.signals.bind(scripted);
    scripted.signals = async () => { throw new EngineError('COMPILE_ERROR', 'broken script'); };
    try {
      await runner().jobHandler.handle({ payload: { instanceId: id } } as never, { isLastAttempt: false });
    } finally {
      scripted.signals = original;
    }
    expect(await instance(id)).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('COMPILE_ERROR') });
  });
});

describe('ownership and limits', () => {
  test('other users cannot start my strategy, use my account, or see my instances', async () => {
    const other = (await activeUser(t)).c;
    const theirAccount = (await other.post('/api/v1/paper/accounts', { name: 'X' })).body.id;
    expect((await other.post(`/api/v1/paper/strategies/${strategyId}/start`, { accountId: theirAccount })).body.code).toBe('STRATEGY_NOT_FOUND');
    const theirStrategy = (await other.post('/api/v1/strategies', { name: 'Theirs', definition: definition() })).body.id;
    expect((await other.post(`/api/v1/paper/strategies/${theirStrategy}/start`, { accountId })).status).toBe(404);
    const mine = (await c.get('/api/v1/paper/strategies')).body.strategies[0];
    expect((await other.get(`/api/v1/paper/strategies/${mine.id}`)).status).toBe(404);
    expect((await other.post(`/api/v1/paper/strategies/${mine.id}/pause`)).status).toBe(404);
    expect((await other.get('/api/v1/paper/strategies')).body.total).toBe(0);
  });

  test('at most 5 live strategies per user', async () => {
    const u = await activeUser(t);
    const sid = (await u.c.post('/api/v1/strategies', { name: 'Limit test', definition: definition() })).body.id;
    const accounts = [];
    for (let i = 0; i < 6; i++) accounts.push((await u.c.post('/api/v1/paper/accounts', { name: `a${i}` })).body.id);
    const results = [];
    for (const a of accounts) results.push((await u.c.post(`/api/v1/paper/strategies/${sid}/start`, { accountId: a })).status);
    expect(results).toEqual([201, 201, 201, 201, 201, 422]);
  });
});

describe('consistency with backtesting (real sandboxed Resin)', () => {
  test('live signals on completed candles agree with the backtester\'s trades on the same data', async () => {
    const engine = new ResinEngine(t.backtesting.signalWorkers);
    const { definitionToPine } = await import('../../src/modules/backtesting');
    const { strategyDefinitionSchema } = await import('../../src/modules/strategies/domain/definition');
    const def = strategyDefinitionSchema.parse(definition({ exit: { conditions: [{ left: { type: 'EMA', period: 10 }, operator: 'CROSSES_BELOW', right: { type: 'EMA', period: 30 } }] } }));
    const source = definitionToPine('EMA', def);
    const candles = walk(600, { seed: 21 });
    const input = engineInput(source, candles);
    const backtest = await engine.run(input);
    const signals = await engine.signals({ ...input, bars: 600 });
    const at = new Map(signals.bars.map((b, i) => [b.openTime, { ...b, i }]));
    expect(backtest.trades.length).toBeGreaterThan(3);
    for (const trade of backtest.trades) {
      // Backtest orders fill at the next bar's open, so the signal is on the bar before the fill.
      const fillIndex = at.get(trade.entryTime)!.i;
      expect(signals.bars[fillIndex - 1]!.entry).toBe(true);
      const exitIndex = at.get(trade.exitTime)!.i;
      expect(signals.bars[exitIndex - 1]!.exit).toBe(true);
    }
  });
});
