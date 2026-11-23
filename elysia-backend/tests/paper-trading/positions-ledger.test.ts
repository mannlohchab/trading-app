import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { paperAccounts, paperTransactions } from '../../src/db/schema';
import { dec } from '../../src/modules/backtesting';
import { activeUser } from '../helpers/users';
import { order, reconciled, setup, tick, tickAndProcess, type App, type Http } from './fixtures';

let t: App;
beforeAll(async () => { ({ t } = await setup()); });
afterAll(() => t.close());

async function account(balance = '10000') {
  const { c } = await activeUser(t);
  const id = (await c.post('/api/v1/paper/accounts', { name: 'P', initialBalance: balance })).body.id as string;
  return { c, id };
}
const px = (p: string) => ({ bid: p, ask: p });
const place = (c: Http, id: string, o: Record<string, unknown>) => c.post('/api/v1/paper/orders', order(id, { type: 'MARKET', ...o }));
const openPosition = async (c: Http, id: string) => (await c.get(`/api/v1/paper/positions?accountId=${id}&status=OPEN`)).body.positions[0];

describe('positions (one-way mode)', () => {
  test('long: open, increase at a new average, partial close, full close', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '100', px('100'));
    const zeroSlip = { side: 'BUY', quantity: '1' };
    await t.paperTrading.services.orders.place((await t.db.select().from(paperAccounts).where(eq(paperAccounts.id, id)))[0]!.userId, { accountId: id, symbol: 'BTCUSDT', type: 'MARKET', ...zeroSlip, quantity: '1' } as never, { execution: { commissionPercent: '0', slippageBps: 0 } });
    tick(t, 'BTCUSDT', '120', px('120'));
    const userId = (await t.db.select().from(paperAccounts).where(eq(paperAccounts.id, id)))[0]!.userId;
    const exec = { execution: { commissionPercent: '0', slippageBps: 0 } };
    await t.paperTrading.services.orders.place(userId, { accountId: id, symbol: 'BTCUSDT', type: 'MARKET', side: 'BUY', quantity: '3' }, exec);
    let p = await openPosition(c, id);
    expect(p).toMatchObject({ side: 'LONG', quantity: '4', averageEntryPrice: '115', collateral: '460', status: 'OPEN' });
    tick(t, 'BTCUSDT', '130', px('130'));
    await t.paperTrading.services.orders.place(userId, { accountId: id, symbol: 'BTCUSDT', type: 'MARKET', side: 'SELL', quantity: '1' }, exec);
    p = await openPosition(c, id);
    expect(p).toMatchObject({ quantity: '3', averageEntryPrice: '115', realizedPnl: '15', unrealizedPnl: '45', markPrice: '130' });
    tick(t, 'BTCUSDT', '110', px('110'));
    await t.paperTrading.services.orders.place(userId, { accountId: id, symbol: 'BTCUSDT', type: 'MARKET', side: 'SELL', quantity: '3' }, exec);
    expect(await openPosition(c, id)).toBeUndefined();
    const closed = (await c.get(`/api/v1/paper/positions?accountId=${id}&status=CLOSED`)).body.positions[0];
    expect(closed).toMatchObject({ status: 'CLOSED', quantity: '0', realizedPnl: '0', unrealizedPnl: '0' }); // +15 then −15
    expect((await c.get(`/api/v1/paper/accounts/${id}`)).body).toMatchObject({ cashBalance: '10000', realizedPnl: '0', reservedBalance: '0' });
    await reconciled(t, id);
  });

  test('short: profit when price falls, fees accumulate on the position', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '70000', px('70000'));
    await place(c, id, { side: 'SELL', quantity: '0.1' }); // 69965 (bid − 5 bps)
    let p = await openPosition(c, id);
    expect(p).toMatchObject({ side: 'SHORT', quantity: '0.1', averageEntryPrice: '69965', totalFees: '6.9965' });
    tick(t, 'BTCUSDT', '68000', px('68000'));
    p = await openPosition(c, id);
    expect(p.unrealizedPnl).toBe('196.5'); // (69965 − 68000) × 0.1
    const res = (await c.post(`/api/v1/paper/positions/${p.id}/close`)).body;
    expect(res.order).toMatchObject({ status: 'FILLED', side: 'BUY', reduceOnly: true, source: 'CLOSE', averageFillPrice: '68034' }); // ask + 5 bps
    expect(res.position).toMatchObject({ status: 'CLOSED', realizedPnl: '193.1', totalFees: dec.add('6.9965', '6.8034') });
    expect((await c.post(`/api/v1/paper/positions/${p.id}/close`)).body.code).toBe('NO_POSITION');
    await reconciled(t, id);
  });

  test('a sell larger than the long reverses into a short at the fill price', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '70000', px('70000'));
    await place(c, id, { side: 'BUY', quantity: '0.02' });
    await place(c, id, { side: 'SELL', quantity: '0.05' });
    const positions = (await c.get(`/api/v1/paper/positions?accountId=${id}`)).body.positions;
    // Both positions share a timestamp under the test clock, so compare without relying on list order.
    expect(positions.map((p: { side: string; status: string; quantity: string }) => [p.side, p.status, p.quantity]).sort()).toEqual([['LONG', 'CLOSED', '0'], ['SHORT', 'OPEN', '0.03']]);
    await reconciled(t, id);
  });

  test('portfolio: equity = cash + unrealized; exposure and return use current marks', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '70000', px('70000'));
    await place(c, id, { side: 'BUY', quantity: '0.1' }); // 70035, fee 7.0035
    tick(t, 'BTCUSDT', '72000', px('72000'));
    const p = (await c.get(`/api/v1/paper/accounts/${id}/portfolio`)).body;
    expect(p).toMatchObject({
      initialBalance: '10000', cashBalance: '9992.9965', reservedBalance: '7003.5', availableBalance: '2989.4965',
      unrealizedPnl: '196.5', totalEquity: '10189.4965', totalExposure: '7200', totalFees: '7.0035', realizedPnl: '0', returnPercent: '1.894965', unpricedSymbols: [],
    });
  });

  test('a short is force-closed when its loss reaches its collateral', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '1000', px('1000'));
    await place(c, id, { side: 'SELL', quantity: '1' }); // 999.5
    await t.paperTrading.engine.refresh();
    // Entry 999.5 (bid − 5 bps): at 1998 the loss (998.5) is still below the 999.5 collateral…
    await tickAndProcess(t, 'BTCUSDT', '1998', px('1998'));
    expect(await openPosition(c, id)).toBeDefined();
    // …at 1999.5 it has reached it.
    await tickAndProcess(t, 'BTCUSDT', '1999.5', px('1999.5'));
    expect(await openPosition(c, id)).toBeUndefined();
    const orders = (await c.get(`/api/v1/paper/orders?accountId=${id}`)).body.orders;
    expect(orders[0]).toMatchObject({ source: 'LIQUIDATION', status: 'FILLED', side: 'BUY' });
    await reconciled(t, id);
  });
});

describe('ledger', () => {
  test('every balance movement has an entry; the account always equals the sum of its ledger', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '70000', px('70000'));
    await place(c, id, { side: 'BUY', quantity: '0.05' });
    await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '60000' }));
    await place(c, id, { side: 'SELL', quantity: '0.02' });
    const r = await reconciled(t, id);
    const a = (await c.get(`/api/v1/paper/accounts/${id}`)).body;
    expect([r.ledger.cash, r.ledger.reserved, r.ledger.fees]).toEqual([a.cashBalance, a.reservedBalance, a.totalFees]);
    const seqs = (await c.get(`/api/v1/paper/accounts/${id}/transactions?limit=200`)).body.transactions.map((e: { sequence: number }) => e.sequence);
    expect(seqs).toEqual(seqs.map((_: number, i: number) => i + 1)); // gap-free
  });

  test('ledger entries cannot be modified or deleted', async () => {
    const { id } = await account();
    const update = await t.db.update(paperTransactions).set({ amount: '1000000' }).where(eq(paperTransactions.paperAccountId, id)).catch(e => e);
    expect(String(update.cause?.message ?? update.message)).toContain('append-only');
    const del = await t.db.delete(paperTransactions).where(eq(paperTransactions.paperAccountId, id)).catch(e => e);
    expect(String(del.cause?.message ?? del.message)).toContain('append-only');
    expect((await t.db.select().from(paperTransactions).where(eq(paperTransactions.paperAccountId, id)))[0]?.amount).toBe('10000.000000000000');
  });

  test('a duplicate execution attempt books nothing twice', async () => {
    const { c, id } = await account();
    tick(t, 'BTCUSDT', '70000', px('70000'));
    const o = (await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '69000' }))).body;
    tick(t, 'BTCUSDT', '68000', px('68000'));
    const quote = t.paperTrading.services.quotes.latest('BINANCE', 'BTCUSDT')!;
    const results = await Promise.all([t.paperTrading.services.execution.fill(o.id, quote), t.paperTrading.services.execution.fill(o.id, quote), t.paperTrading.services.execution.fill(o.id, quote)]);
    expect(results.map(r => r.outcome).sort()).toEqual(['filled', 'skipped', 'skipped']);
    const fees = await t.db.select().from(paperTransactions).where(eq(paperTransactions.orderId, o.id));
    expect(fees.filter(e => e.transactionType === 'TRADING_FEE')).toHaveLength(1);
    await reconciled(t, id);
  });

  test('concurrent orders cannot spend the same available balance', async () => {
    const { c, id } = await account('1000');
    tick(t, 'BTCUSDT', '1000', px('1000'));
    // Each reserves ~306 (0.3 × 1000 × 1.02 + fee): only three fit in 1000.
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.3', price: '1000', clientOrderId: `race-${i}` })).then(r => r.status)));
    expect(results.filter(s => s === 201).length).toBe(3);
    expect(results.filter(s => s === 422).length).toBe(5);
    const a = (await c.get(`/api/v1/paper/accounts/${id}`)).body;
    expect(dec.cmp(a.availableBalance, '0')).toBeGreaterThanOrEqual(0);
    await reconciled(t, id);
  });

  test('reconciliation detects a balance that does not match the ledger', async () => {
    const { id } = await account();
    await t.db.update(paperAccounts).set({ currentBalance: sql`current_balance + 1` }).where(eq(paperAccounts.id, id));
    const r = await t.paperTrading.services.accounts.reconcile(id);
    expect(r.ok).toBe(false);
    expect(r.mismatches.join()).toContain('cash');
  });
});
