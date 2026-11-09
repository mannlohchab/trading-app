// The live engine against the market hub (fake upstream feed): subscriptions, events, recovery.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { backgroundJobs, paperOrders, paperStrategyInstances } from '../../src/db/schema';
import { latestClosedOpenTime } from '../../src/modules/paper-trading/strategies/strategy-runner.service';
import { activeUser } from '../helpers/users';
import { definition, order, ScriptedSignals, seedClosedHistory, setup, tick, type App, type Http } from './fixtures';

const scripted = new ScriptedSignals();
let t: App, c: Http, accountId: string;
beforeAll(async () => {
  ({ t, c, account: { id: accountId } } = await setup({ signalEngine: scripted }));
  await seedClosedHistory(t, 600);
  await seedClosedHistory(t, 600, 'ETHUSDT');
});
afterAll(async () => { await t.paperTrading.engine.stop(); await t.close(); });

const engine = () => t.paperTrading.engine;
const streamTicker = (symbol: string, price: string, time = t.clock.now().getTime()) => t.feed.emit({
  type: 'ticker', topic: { kind: 'ticker', exchange: 'BINANCE', symbol },
  ticker: { exchange: 'BINANCE', symbol, lastPrice: price, priceChange: '0', priceChangePercent: '0', openPrice: price, highPrice: price, lowPrice: price, volume: '1', quoteVolume: '1', bidPrice: price, askPrice: price, time },
});
const evaluateJobs = () => t.db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, 'paper.strategy.evaluate'));

describe('subscriptions', () => {
  test('subscribes only to what open orders, positions and live strategies need', async () => {
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    await c.post('/api/v1/paper/orders', order(accountId, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '69000' }));
    const sid = (await c.post('/api/v1/strategies', { name: 'ETH strat', definition: definition({ market: { exchange: 'BINANCE', symbol: 'ETHUSDT', timeframe: '1h' } }) })).body.id;
    await c.post(`/api/v1/paper/strategies/${sid}/start`, { accountId });
    await engine().start();
    expect(t.feed.topics.map(x => `${x.kind}:${x.symbol}${x.kind === 'candles' ? `:${x.timeframe}` : ''}`).sort()).toEqual(['candles:ETHUSDT:1h', 'ticker:BTCUSDT']);
  });

  test('two strategies on the same symbol share one upstream subscription', async () => {
    const other = await activeUser(t);
    const acc = (await other.c.post('/api/v1/paper/accounts', { name: 'B' })).body.id;
    const sid = (await other.c.post('/api/v1/strategies', { name: 'ETH strat', definition: definition({ market: { exchange: 'BINANCE', symbol: 'ETHUSDT', timeframe: '1h' } }) })).body.id;
    await other.c.post(`/api/v1/paper/strategies/${sid}/start`, { accountId: acc });
    await engine().refresh();
    expect(t.feed.topics.filter(x => x.kind === 'candles')).toHaveLength(1);
  });
});

describe('market events', () => {
  test('a streamed price fills a resting order', async () => {
    t.clock.advance(1);
    streamTicker('BTCUSDT', '68900');
    await engine().idle();
    const [o] = await t.db.select().from(paperOrders).where(and(eq(paperOrders.paperAccountId, accountId), eq(paperOrders.orderType, 'LIMIT')));
    expect(o).toMatchObject({ status: 'FILLED', averageFillPrice: '69000.000000000000' });
  });

  test('duplicate and out-of-order events are ignored', async () => {
    const before = engine().counters.outOfOrderTickers;
    const time = t.clock.now().getTime() + 500;
    streamTicker('BTCUSDT', '70000', time);
    streamTicker('BTCUSDT', '70000', time); // duplicate
    streamTicker('BTCUSDT', '1', time - 10_000); // late, out of order: must not move the price
    await engine().idle();
    expect(engine().counters.outOfOrderTickers - before).toBe(2);
    expect(t.paperTrading.services.quotes.latest('BINANCE', 'BTCUSDT')?.last).toBe('70000');
  });

  test('while the feed reconnects its quotes are not trusted (falls back to REST, which here is stale)', async () => {
    t.feed.setStatus('reconnecting');
    expect(t.paperTrading.services.quotes.latest('BINANCE', 'BTCUSDT')).toBeNull();
    const res = await c.post('/api/v1/paper/orders', order(accountId, { side: 'BUY', type: 'MARKET', quantity: '0.001' }));
    expect(res.body.code).toBe('STALE_PRICE');
    t.feed.setStatus('live');
  });

  test('a closed candle schedules one evaluation per strategy; unfinished candles schedule none', async () => {
    await t.db.delete(backgroundJobs).where(eq(backgroundJobs.jobType, 'paper.strategy.evaluate'));
    const latest = latestClosedOpenTime('1h', t.clock.now().getTime());
    const candle = (isClosed: boolean) => t.feed.emit({ type: 'candle', topic: { kind: 'candles', exchange: 'BINANCE', symbol: 'ETHUSDT', timeframe: '1h' }, candle: { openTime: latest, closeTime: latest + 3_599_999, open: '1', high: '1', low: '1', close: '1', volume: '1', quoteVolume: '1', trades: 1, isClosed } });
    candle(false);
    await Bun.sleep(20);
    expect(await evaluateJobs()).toHaveLength(0);
    candle(true); candle(true); // duplicate close events
    await Bun.sleep(50);
    const jobs = await evaluateJobs();
    expect(jobs).toHaveLength(2); // two instances on ETHUSDT, one job each despite two events
    expect(new Set(jobs.map(j => j.dedupeKey)).size).toBe(2);
  });

  test('instances sharing a script, market and candle share one sandboxed evaluation', async () => {
    const instances = await t.db.select().from(paperStrategyInstances).where(eq(paperStrategyInstances.status, 'CREATED'));
    for (const i of instances) await t.paperTrading.services.strategies.evaluate(i.id); // → RUNNING
    t.clock.advance(3600);
    await seedClosedHistory(t, 2, 'ETHUSDT');
    const hits = t.paperTrading.services.evaluator.metrics.cacheHits, calls = scripted.calls.length;
    for (const i of instances) await t.paperTrading.services.strategies.evaluate(i.id);
    expect(scripted.calls.length - calls).toBe(1);
    expect(t.paperTrading.services.evaluator.metrics.cacheHits - hits).toBe(1);
  });
});

describe('periodic recovery', () => {
  test('the sweep schedules strategies that fell behind without any market event', async () => {
    await t.db.delete(backgroundJobs).where(eq(backgroundJobs.jobType, 'paper.strategy.evaluate'));
    t.clock.advance(3600); // a candle closed, but no event arrived
    await engine().sweep();
    expect((await evaluateJobs()).length).toBeGreaterThanOrEqual(2);
  });

  test('a market order that never gets a fresh price is expired and its reservation released', async () => {
    const { db } = t;
    const [acc] = await db.select().from((await import('../../src/db/schema')).paperAccounts).where(eq((await import('../../src/db/schema')).paperAccounts.id, accountId));
    const [o] = await db.insert(paperOrders).values({ paperAccountId: accountId, userId: acc!.userId, symbolId: (await t.paperTrading.services.repo.symbolRules('BINANCE', 'SOLUSDT'))!.id, side: 'BUY', orderType: 'MARKET', quantity: '1', status: 'PENDING', createdAt: new Date(t.clock.now().getTime() - 120_000) }).returning();
    t.feed.setStatus('reconnecting'); // no streamed SOL price; REST fixture prices are stale
    await engine().sweep();
    t.feed.setStatus('live');
    expect((await db.select().from(paperOrders).where(eq(paperOrders.id, o!.id)))[0]).toMatchObject({ status: 'EXPIRED' });
  });

  test('operational metrics are reported', async () => {
    const m = await engine().metrics();
    expect(m).toMatchObject({ activeAccounts: expect.any(Number), runningStrategies: 2, openPositions: expect.any(Number), subscriptions: expect.any(Number), fills: expect.any(Number), duplicateSignalsPrevented: expect.any(Number), missedCandleRecoveries: expect.any(Number) });
    expect(m.feedStatus).toEqual({ BINANCE: 'live' });
  });
});
