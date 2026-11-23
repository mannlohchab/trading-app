import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { marketCandles } from '../../src/db/schema';
import { MarketServiceCandleHistory } from '../../src/modules/backtesting/backtesting.market-history';
import { BacktestingRepository } from '../../src/modules/backtesting/backtesting.repository';
import { DatasetError, expectedCandleCount, validateDataset } from '../../src/modules/backtesting/utils/validation';
import { MarketError, ProviderUnavailableError } from '../../src/modules/market/application/errors';
import { MarketDataService } from '../../src/modules/market/application/market-data.service';
import type { MarketDataProvider } from '../../src/modules/market/application/ports';
import type { Timeframe } from '../../src/modules/market/domain/market-options';
import type { Candle, Ticker } from '../../src/modules/market/domain/types';
import { DrizzleCandleRepository } from '../../src/modules/market/infrastructure/drizzle-candle.repository';
import { DrizzleInstrumentRepository } from '../../src/modules/market/infrastructure/drizzle-instrument.repository';
import { MemoryCache } from '../../src/modules/market/infrastructure/memory-cache';
import { instrument } from '../helpers/fake-market';
import { createTestDb } from '../helpers/test-db';
import { walk } from './fixtures';

const HOUR = 3_600_000, START = Date.parse('2026-06-01T00:00:00Z');
type Database = Awaited<ReturnType<typeof createTestDb>>;

/** Provider boundary only is a fixture. Pagination honors inclusive endTime as Binance does. */
class HistoricalFixtureProvider implements MarketDataProvider {
  readonly exchange = 'BINANCE';
  down = false;
  calls: { symbol: string; timeframe: Timeframe; limit: number; endTime?: number }[] = [];
  constructor(readonly candles: Candle[]) {}
  async fetchInstruments() { return [instrument('BTCUSDT', 'BTC', 'USDT')]; }
  async fetchTickers(): Promise<Ticker[]> { return []; }
  async fetchCandles(symbol: string, timeframe: Timeframe, options: { limit: number; endTime?: number }) {
    this.calls.push({ symbol, timeframe, ...options });
    if (this.down) throw new ProviderUnavailableError('Fixture provider unavailable');
    return this.candles.filter(c => options.endTime === undefined || c.openTime <= options.endTime).slice(-options.limit);
  }
}

const historyBars = (count: number) => walk(count, { start: START }).map(c => ({ ...c, quoteVolume: '10000', trades: 10, isClosed: true }));

describe('real candle backfill and persistence integration', () => {
  let database: Database, instruments: DrizzleInstrumentRepository, candleStore: DrizzleCandleRepository, repo: BacktestingRepository, symbolId: string;
  beforeAll(async () => {
    database = await createTestDb();
    instruments = new DrizzleInstrumentRepository(database.appDb);
    candleStore = new DrizzleCandleRepository(database.appDb);
    repo = new BacktestingRepository(database.appDb);
    await instruments.sync('BINANCE', [instrument('BTCUSDT', 'BTC', 'USDT'), instrument('ETHUSDT', 'ETH', 'USDT')]);
    symbolId = (await instruments.findActive('BINANCE', ['BTCUSDT'])).get('BTCUSDT')!.id;
  });
  afterAll(async () => { await database?.close(); });
  beforeEach(async () => { await database.db.delete(marketCandles); });

  function fixture(candles: Candle[], now = Date.parse('2026-11-01T00:00:00Z')) {
    const provider = new HistoricalFixtureProvider(candles);
    let time = now;
    const market = new MarketDataService({ providers: [provider], instruments, candles: candleStore,
      cache: new MemoryCache(() => time), clock: { now: () => new Date(time) } });
    const history = new MarketServiceCandleHistory(market);
    return { provider, market, history, advance: (milliseconds: number) => { time += milliseconds; } };
  }

  const ensure = (history: MarketServiceCandleHistory, start: number, end: number, stored = 0) => history.ensure({
    exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h', start, end,
    expected: expectedCandleCount('1h', start, end), stored,
  });

  test('pages backwards through more than 2,000 candles and persists retry-safe bounded history', async () => {
    const candles = historyBars(2500), start = candles[150]!.openTime, end = candles[2400]!.openTime;
    const { provider, history, advance } = fixture(candles);
    // Existing observations overlap the first page; retries must not duplicate them.
    await candleStore.saveClosed(symbolId, '1h', candles.slice(2350, 2400));
    await ensure(history, start, end, 50);
    expect(provider.calls.map(call => call.endTime)).toEqual([end - 1, candles[1400]!.openTime - 1, candles[400]!.openTime - 1]);
    expect(provider.calls.every(call => call.limit === 1000 && call.symbol === 'BTCUSDT' && call.timeframe === '1h')).toBe(true);
    const stored = await repo.loadCandles(symbolId, '1h', start, end);
    expect(stored).toHaveLength(2250);
    expect(stored[0]!.openTime).toBe(start);
    expect(stored.at(-1)!.closeTime).toBe(end - 1);
    expect(new Set(stored.map(c => c.openTime)).size).toBe(2250);
    expect(stored.every(c => c.isClosed && c.openTime >= start && c.closeTime < end)).toBe(true);
    expect(validateDataset(stored, '1h', { start, end, now: end + HOUR }).missing).toBe(0);
    const persisted = await database.db.select().from(marketCandles);
    expect(persisted).toHaveLength(2400); // Earlier page overfetch is stored, but never leaks into the requested range.

    await ensure(history, start, end, await repo.countCandles(symbolId, '1h', start, end));
    expect(provider.calls).toHaveLength(3); // Complete coverage needs no provider call.
    advance(61_000); // Expire REST cache and exercise repeated real writes, not a cached response.
    await ensure(history, start, end);
    expect(provider.calls).toHaveLength(6);
    expect(await database.db.select().from(marketCandles)).toHaveLength(2400);
  }, 15_000);

  test('partial end candles are excluded and repository reads isolate symbol, timeframe, and range', async () => {
    const candles = historyBars(140), start = candles[10]!.openTime, end = candles[130]!.openTime + HOUR / 2;
    const { history, provider } = fixture(candles, end);
    const ethId = (await instruments.findActive('BINANCE', ['ETHUSDT'])).get('ETHUSDT')!.id;
    await candleStore.saveClosed(ethId, '1h', candles);
    await candleStore.saveClosed(symbolId, '5m', [{ ...candles[10]!, closeTime: start + 300_000 - 1 }]);
    await ensure(history, start, end);
    expect(provider.calls).toHaveLength(1);
    const loaded = await repo.loadCandles(symbolId, '1h', start, end);
    expect(loaded).toHaveLength(120);
    expect(loaded.at(-1)!.closeTime).toBe(candles[130]!.openTime - 1);
    expect(validateDataset(loaded, '1h', { start, end, now: end })).toMatchObject({ expected: 120, missing: 0 });
    expect(await repo.countCandles(symbolId, '1h', candles[130]!.openTime, candles[131]!.openTime)).toBe(0);
  });

  test('provider gaps survive persistence and are reported or rejected without invented candles', async () => {
    const candles = historyBars(300), end = candles.at(-1)!.closeTime + 1;
    const missing = new Set([50, 51]);
    const small = fixture(candles.filter((_, i) => !missing.has(i)));
    await ensure(small.history, START, end);
    const loaded = await repo.loadCandles(symbolId, '1h', START, end);
    const report = validateDataset(loaded, '1h', { start: START, end, now: end + HOUR });
    expect(report).toMatchObject({ expected: 300, missing: 2, gaps: [{ from: candles[50]!.openTime, to: candles[52]!.openTime, missing: 2 }] });
    expect(loaded).toHaveLength(298);

    await database.db.delete(marketCandles);
    const large = fixture(candles.filter((_, i) => i < 100 || i >= 120));
    await ensure(large.history, START, end);
    const incomplete = await repo.loadCandles(symbolId, '1h', START, end);
    let failure: unknown;
    try { validateDataset(incomplete, '1h', { start: START, end, now: end + HOUR }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DatasetError);
    expect(failure).toMatchObject({ code: 'DATA_GAPS', details: { missing: 20, expected: 300 } });
  });

  test('provider outage falls back to stored observations and stops backfill without concealing gaps', async () => {
    const candles = historyBars(150), end = candles.at(-1)!.closeTime + 1;
    await candleStore.saveClosed(symbolId, '1h', candles.slice(0, 120));
    const { market, history, provider } = fixture(candles);
    provider.down = true;
    const fallback = await market.candles({ exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h', limit: 1000, endTime: end - 1 });
    expect(fallback.source).toBe('store');
    expect(fallback.candles).toHaveLength(120);
    expect(fallback.candles.at(-1)!.closeTime).toBe(candles[119]!.closeTime);
    await ensure(history, START, end, 120);
    expect(provider.calls).toHaveLength(2); // One fallback per request; no repeated pagination over the same stored rows.
    const loaded = await repo.loadCandles(symbolId, '1h', START, end);
    expect(loaded).toHaveLength(120);
    expect(() => validateDataset(loaded, '1h', { start: START, end, now: end + HOUR })).toThrow(DatasetError);
  });

  test('an outage with no stored candles fails explicitly and recovers on a later fetch', async () => {
    const candles = historyBars(120), end = candles.at(-1)!.closeTime + 1;
    const { provider, history } = fixture(candles);
    provider.down = true;
    let failure: unknown;
    try { await ensure(history, START, end); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MarketError);
    expect(failure).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(await repo.countCandles(symbolId, '1h', START, end)).toBe(0);
    provider.down = false;
    await ensure(history, START, end);
    expect(provider.calls).toHaveLength(2); // Failed provider loads must not poison the REST cache.
    expect(await repo.countCandles(symbolId, '1h', START, end)).toBe(120);
  });
});
