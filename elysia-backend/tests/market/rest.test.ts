import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { marketCandles } from '../../src/db/schema';
import { candle } from '../helpers/fake-market';
import { createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
let c: Awaited<ReturnType<typeof activeUser>>['c'];
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  ({ c } = await activeUser(t));
});
afterAll(() => t.close());

test('market data is for active users only', async () => {
  const pending = await pendingUser(t);
  expect((await pending.c.get('/api/v1/market/exchanges')).status).toBe(403);
});

test('exchanges lists those with a registered provider', async () => {
  expect((await c.get('/api/v1/market/exchanges')).body).toEqual({ exchanges: [{ code: 'BINANCE', name: 'Binance', type: 'CRYPTO' }] });
});

describe('symbols', () => {
  test('search by quote asset and text, with paging', async () => {
    const usdt = await c.get('/api/v1/market/symbols?quote=usdt');
    expect(usdt.body.total).toBe(3);
    expect(usdt.body.symbols.map((s: any) => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    expect(usdt.body.symbols[0]).not.toHaveProperty('id');

    const eth = await c.get('/api/v1/market/symbols?q=eth');
    expect(eth.body.symbols.map((s: any) => s.symbol)).toEqual(['ETHBTC', 'ETHUSDT']);

    const page = await c.get('/api/v1/market/symbols?quote=USDT&limit=1&offset=1');
    expect(page.body).toMatchObject({ total: 3, symbols: [{ symbol: 'ETHUSDT' }] });
  });

  test('SQL wildcards in the search text are matched literally', async () => {
    expect((await c.get('/api/v1/market/symbols?q=%25')).body.total).toBe(0);
  });

  test('unknown exchanges are 404', async () => {
    const res = await c.get('/api/v1/market/symbols?exchange=KRAKEN');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('UNKNOWN_EXCHANGE');
  });
});

describe('tickers', () => {
  test('for specific symbols, in the requested order', async () => {
    const res = await c.get('/api/v1/market/tickers?symbols=ethusdt,BTCUSDT');
    expect(res.status).toBe(200);
    expect(res.body.tickers.map((x: any) => [x.symbol, x.lastPrice])).toEqual([['ETHUSDT', '2093.12'], ['BTCUSDT', '73886.01']]);
  });

  test('unknown symbols are reported', async () => {
    const res = await c.get('/api/v1/market/tickers?symbols=BTCUSDT,NOPEUSDT');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'UNKNOWN_SYMBOL', symbols: ['NOPEUSDT'] });
  });

  test('market list: one quote asset, sorted, only catalogued symbols', async () => {
    const byVolume = await c.get('/api/v1/market/tickers?quote=USDT');
    expect(byVolume.body.tickers.map((x: any) => x.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']); // DELISTEDUSDT excluded
    const gainers = await c.get('/api/v1/market/tickers?quote=USDT&sort=gainers&limit=2');
    expect(gainers.body.tickers.map((x: any) => x.symbol)).toEqual(['SOLUSDT', 'ETHUSDT']);
    const losers = await c.get('/api/v1/market/tickers?quote=USDT&sort=losers&limit=1');
    expect(losers.body.tickers.map((x: any) => x.symbol)).toEqual(['BTCUSDT']);
  });

  test('upstream calls are shared through a short cache', async () => {
    const before = t.provider.calls.tickers;
    await Promise.all([c.get('/api/v1/market/tickers?quote=USDT'), c.get('/api/v1/market/tickers?symbols=BTCUSDT')]);
    expect(t.provider.calls.tickers - before).toBeLessThanOrEqual(1);
  });
});

describe('candles', () => {
  let base: number;
  beforeAll(() => { base = Math.floor(t.clock.now().getTime() / 60_000) * 60_000 - 10 * 60_000; }); // 10 minutes ago

  test('serves exchange candles and saves the closed ones to Postgres', async () => {
    t.provider.candles = [candle(base, '10'), candle(base + 60_000, '11'), candle(t.clock.now().getTime() - 1000, '12', false)];
    const res = await c.get('/api/v1/market/candles?symbol=BTCUSDT&timeframe=1m&limit=3');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1m', source: 'exchange' });
    expect(res.body.candles.map((x: any) => [x.close, x.isClosed])).toEqual([['10', true], ['11', true], ['12', false]]);

    const stored = await t.db.select().from(marketCandles).where(eq(marketCandles.timeframe, '1m'));
    expect(stored.map(r => r.openTime).sort()).toEqual([base, base + 60_000]);
  });

  test('falls back to stored history when the exchange is down', async () => {
    t.provider.down = true;
    t.clock.advance(5); // past the cache TTL
    try {
      const res = await c.get('/api/v1/market/candles?symbol=BTCUSDT&timeframe=1m&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('store');
      expect(res.body.candles.map((x: any) => x.close)).toEqual(['10', '11']);

      const none = await c.get('/api/v1/market/candles?symbol=ETHUSDT&timeframe=1h');
      expect(none.status).toBe(503);
      expect(none.body.code).toBe('PROVIDER_UNAVAILABLE');
    } finally {
      t.provider.down = false;
    }
  });

  test('validates parameters', async () => {
    expect((await c.get('/api/v1/market/candles?symbol=BTCUSDT&timeframe=2h')).body.fields).toHaveProperty('timeframe');
    expect((await c.get('/api/v1/market/candles?symbol=BTCUSDT&timeframe=1h&limit=5000')).body.fields).toHaveProperty('limit');
    expect((await c.get('/api/v1/market/candles?symbol=NOPE&timeframe=1h')).status).toBe(404);
  });
});
