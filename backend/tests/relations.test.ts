import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { exchanges, paperAccounts, paperOrders, tradingSymbols, userProfiles, users } from '../src/db/schema';
import { createTestDb } from './helpers/test-db';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

test('relational queries load nested data across domains', async () => {
  const [user] = await t.db.insert(users).values({ username: 'rel_check' }).returning();
  await t.db.insert(userProfiles).values({ userId: user.id, firstName: 'Asha' });
  const [binance] = await t.db.select().from(exchanges).where(eq(exchanges.code, 'BINANCE'));
  const [btc] = await t.db.insert(tradingSymbols)
    .values({ exchangeId: binance.id, symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }).returning();
  const [account] = await t.db.insert(paperAccounts)
    .values({ userId: user.id, name: 'Main', initialBalance: '1000', currentBalance: '123456789012345678.123456789012' }).returning();
  await t.db.insert(paperOrders)
    .values({ paperAccountId: account.id, userId: user.id, symbolId: btc.id, side: 'BUY', orderType: 'MARKET', quantity: '0.5' });

  const loaded = await t.db.query.users.findFirst({
    where: eq(users.id, user.id),
    with: { profile: true, paperAccounts: { with: { orders: { with: { symbol: { with: { exchange: true } } } } } } },
  });

  expect(loaded?.profile?.firstName).toBe('Asha');
  // NUMERIC must survive the nested-JSON path exactly, formatted like a flat select.
  expect(loaded?.paperAccounts[0].currentBalance).toBe('123456789012345678.123456789012');
  const order = loaded?.paperAccounts[0].orders[0];
  expect(order?.quantity).toBe('0.500000000000');
  expect(order?.symbol.symbol).toBe('BTCUSDT');
  expect(order?.symbol.exchange.code).toBe('BINANCE');
});
