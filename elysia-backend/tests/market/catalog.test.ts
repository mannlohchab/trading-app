import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { tradingSymbols } from '../../src/db/schema';
import { createTestApp } from '../helpers/test-app';
import { instrument } from '../helpers/fake-market';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp(); });
afterAll(() => t.close());

const active = async () =>
  (await t.db.select().from(tradingSymbols).where(eq(tradingSymbols.isActive, true))).map(r => r.symbol).sort();

test('sync stores instruments with exact sizes, and is idempotent', async () => {
  expect(await t.market.catalog.sync('BINANCE')).toEqual({ upserted: 4, deactivated: 0 });
  expect(await t.market.catalog.sync('BINANCE')).toEqual({ upserted: 4, deactivated: 0 });
  expect(await active()).toEqual(['BTCUSDT', 'ETHBTC', 'ETHUSDT', 'SOLUSDT']);
  const [btc] = await t.db.select().from(tradingSymbols).where(eq(tradingSymbols.symbol, 'BTCUSDT'));
  expect(btc).toMatchObject({ assetType: 'SPOT', pricePrecision: 2, priceTickSize: '0.010000000000', metadata: { minNotional: '5' } });
});

test('delisted symbols are deactivated (not deleted) and come back if relisted', async () => {
  const all = t.provider.instruments;
  t.provider.instruments = all.filter(i => i.symbol !== 'SOLUSDT');
  expect(await t.market.catalog.sync('BINANCE')).toEqual({ upserted: 3, deactivated: 1 });
  const [sol] = await t.db.select().from(tradingSymbols).where(and(eq(tradingSymbols.symbol, 'SOLUSDT')));
  expect(sol?.isActive).toBe(false);

  t.provider.instruments = [...all, instrument('DOGEUSDT', 'DOGE', 'USDT')];
  await t.market.catalog.sync('BINANCE');
  expect(await active()).toEqual(['BTCUSDT', 'DOGEUSDT', 'ETHBTC', 'ETHUSDT', 'SOLUSDT']);
  t.provider.instruments = all;
});

test('an empty or failed answer never wipes the catalog', async () => {
  const all = t.provider.instruments;
  t.provider.instruments = [];
  await expect(t.market.catalog.sync('BINANCE')).rejects.toThrow('no instruments');
  t.provider.instruments = all;
  t.provider.down = true;
  expect((await t.market.catalog.syncStale()).BINANCE).toEqual({ skipped: true }); // fresh, so not even attempted
  t.provider.down = false;
  expect((await active()).length).toBeGreaterThan(0);
});

test('stale catalogs are re-synced', async () => {
  t.clock.advance(25 * 3600);
  const before = t.provider.calls.instruments;
  expect((await t.market.catalog.syncStale()).BINANCE).toMatchObject({ upserted: expect.any(Number) });
  expect(t.provider.calls.instruments).toBe(before + 1);
});
