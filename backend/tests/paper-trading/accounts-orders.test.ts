import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { paperOrders, paperTransactions } from '../../src/db/schema';
import { client } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { order, reconciled, setup, tick, tickAndProcess, type App, type Http } from './fixtures';

let t: App, c: Http, main: Http, accountId: string;
beforeAll(async () => { ({ t, c, account: { id: accountId } } = await setup()); main = c; });
afterAll(() => t.close());

/** A new user with one account (keeps each scenario's ledger separate and under the per-user cap). */
const freshAccount = async (balance = '10000') => {
  c = (await activeUser(t)).c;
  return (await c.post('/api/v1/paper/accounts', { name: 'Scenario', initialBalance: balance })).body.id as string;
};
const ledger = async (id: string) => (await c.get(`/api/v1/paper/accounts/${id}/transactions?limit=200`)).body.transactions as { type: string; amount: string; reservedDelta: string }[];

describe('accounts', () => {
  test('creation funds the account through the ledger', async () => {
    const res = await c.get(`/api/v1/paper/accounts/${accountId}`);
    expect(res.body).toMatchObject({ initialBalance: '10000', cashBalance: '10000', reservedBalance: '0', availableBalance: '10000', currency: 'USDT', status: 'ACTIVE', ledgerReconciled: true });
    expect(await ledger(accountId)).toMatchObject([{ type: 'INITIAL_DEPOSIT', amount: '10000' }]);
  });

  test('initial balance limits, multiple accounts and the per-user cap', async () => {
    expect((await c.post('/api/v1/paper/accounts', { name: 'x', initialBalance: '50' })).status).toBe(400);
    expect((await c.post('/api/v1/paper/accounts', { name: 'x', initialBalance: '20000000' })).status).toBe(400);
    expect((await c.post('/api/v1/paper/accounts', { name: 'x', initialBalance: '1000', userId: crypto.randomUUID() })).status).toBe(400); // strict
    const u = await activeUser(t);
    for (let i = 0; i < 10; i++) expect((await u.c.post('/api/v1/paper/accounts', { name: `n${i}` })).status).toBe(201);
    expect((await u.c.post('/api/v1/paper/accounts', { name: 'one too many' })).body.code).toBe('TOO_MANY_ACCOUNTS');
    expect((await u.c.get('/api/v1/paper/accounts?limit=3&offset=2')).body).toMatchObject({ total: 10, limit: 3, offset: 2, accounts: expect.any(Array) });
  });

  test('paused accounts take no orders; closing requires an empty account and is final', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '69999.99', ask: '70000.01' });
    expect((await c.patch(`/api/v1/paper/accounts/${id}`, { status: 'PAUSED' })).body.status).toBe('PAUSED');
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01' }))).body.code).toBe('ACCOUNT_NOT_ACTIVE');
    await c.patch(`/api/v1/paper/accounts/${id}`, { status: 'ACTIVE' });
    await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01' }));
    expect((await c.patch(`/api/v1/paper/accounts/${id}`, { status: 'CLOSED' })).body.code).toBe('ACCOUNT_NOT_EMPTY');
    const [pos] = (await c.get(`/api/v1/paper/positions?accountId=${id}&status=OPEN`)).body.positions;
    await c.post(`/api/v1/paper/positions/${pos.id}/close`);
    expect((await c.patch(`/api/v1/paper/accounts/${id}`, { status: 'CLOSED' })).body.status).toBe('CLOSED');
    expect((await c.patch(`/api/v1/paper/accounts/${id}`, { status: 'ACTIVE' })).body.code).toBe('ACCOUNT_NOT_ACTIVE');
    await reconciled(t, id);
  });
});

describe('market orders', () => {
  test('BUY fills at the ask plus slippage; commission and collateral are booked exactly', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '69999.99', ask: '70000.01' });
    const res = await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01' }));
    expect(res.status).toBe(201);
    // 70000.01 × 1.0005 = 70035.010005 → rounded up to the 0.01 tick
    expect(res.body).toMatchObject({ status: 'FILLED', filledQuantity: '0.01', averageFillPrice: '70035.02', commission: '0.7003502', reservedAmount: '0' });
    const a = (await c.get(`/api/v1/paper/accounts/${id}`)).body;
    expect(a).toMatchObject({ cashBalance: '9999.2996498', reservedBalance: '700.3502', availableBalance: '9298.9494498', totalFees: '0.7003502' });
    expect((await ledger(id)).map(e => e.type)).toEqual(['INITIAL_DEPOSIT', 'ORDER_RESERVE', 'ORDER_RELEASE', 'ORDER_FILL', 'POSITION_MARGIN', 'TRADING_FEE']);
    await reconciled(t, id);
  });

  test('SELL against the long fills at the bid minus slippage and realizes P/L', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.1' })); // 70035
    tick(t, 'BTCUSDT', '71000', { bid: '71000', ask: '71000' });
    const sell = (await c.post('/api/v1/paper/orders', order(id, { side: 'SELL', type: 'MARKET', quantity: '0.1' }))).body;
    expect(sell).toMatchObject({ status: 'FILLED', averageFillPrice: '70964.5' }); // 71000 × 0.9995
    const a = (await c.get(`/api/v1/paper/accounts/${id}`)).body;
    expect(a.realizedPnl).toBe('92.95'); // (70964.5 − 70035) × 0.1
    expect(a.totalFees).toBe('14.09995'); // 7.0035 + 7.09645
    expect(a.cashBalance).toBe('10078.85005'); // 10000 + 92.95 − 14.09995
    expect(a.reservedBalance).toBe('0');
    await reconciled(t, id);
  });

  test('market orders are refused without a fresh price', async () => {
    const id = await freshAccount();
    t.clock.advance(60); // every quote is now older than 15 s, and the REST fixture tickers are years old
    const res = await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01' }));
    expect([res.status, res.body.code]).toEqual([503, 'STALE_PRICE']);
  });

  test('insufficient balance, symbol rules and reduce-only without a position are rejected', async () => {
    const id = await freshAccount('1000');
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    const big = await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.1' })); // 7000 > 1000
    expect([big.status, big.body.code]).toEqual([422, 'INSUFFICIENT_BALANCE']);
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.000015' }))).body.fields.quantity).toContain('lot size');
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.00001' }))).body.fields.quantity).toContain('minimum notional');
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '100.005' }))).body.fields.price).toContain('tick size');
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01' }))).body.fields.price).toBeDefined();
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'SELL', type: 'MARKET', quantity: '0.01', reduceOnly: true }))).body.code).toBe('NO_POSITION');
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '-1' }))).status).toBe(400);
    expect((await c.post('/api/v1/paper/orders', order(id, { symbol: 'NOPEUSDT', side: 'BUY', type: 'MARKET', quantity: '1' }))).body.code).toBe('UNKNOWN_SYMBOL');
    // A USDT account cannot book a BTC-priced pair as if its prices were USDT.
    tick(t, 'ETHBTC', '0.0283', { bid: '0.0283', ask: '0.0283' });
    const foreign = await c.post('/api/v1/paper/orders', order(id, { symbol: 'ETHBTC', side: 'BUY', type: 'LIMIT', quantity: '1', price: '0.0283' }));
    expect([foreign.status, foreign.body.code]).toEqual([404, 'UNKNOWN_SYMBOL']);
    expect(foreign.body.error).toContain('USDT pairs only');
    expect((await c.get(`/api/v1/paper/accounts/${id}`)).body).toMatchObject({ cashBalance: '1000', reservedBalance: '0' });
    await reconciled(t, id);
  });

  test('a repeated request with the same idempotency key returns the same order and books nothing twice', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    const body = order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01', clientOrderId: 'my-order-1' });
    const first = await c.post('/api/v1/paper/orders', body);
    const again = await c.post('/api/v1/paper/orders', body);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body.id).toBe(first.body.id);
    const viaHeader = await t.app.request('/api/v1/paper/orders', { method: 'POST', headers: { Cookie: c.cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'my-order-1', Origin: 'http://localhost:4001', 'X-Forwarded-For': '10.9.9.9' }, body: JSON.stringify(order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01' })) });
    expect((await viaHeader.json() as { id: string }).id).toBe(first.body.id);
    expect((await ledger(id)).filter(e => e.type === 'TRADING_FEE')).toHaveLength(1);
    await reconciled(t, id);
  });
});

describe('limit and stop orders', () => {
  test('LIMIT BUY rests until the ask reaches it, then fills at the limit (maker)', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    const o = (await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '69000' }))).body;
    expect(o).toMatchObject({ status: 'OPEN', reservedAmount: '690.69' }); // 690 collateral + 0.69 fee
    await tickAndProcess(t, 'BTCUSDT', '69500', { bid: '69500', ask: '69500' });
    expect((await c.get(`/api/v1/paper/orders/${o.id}`)).body.status).toBe('OPEN');
    await tickAndProcess(t, 'BTCUSDT', '68800', { bid: '68800', ask: '68800' }); // gapped below the limit
    expect((await c.get(`/api/v1/paper/orders/${o.id}`)).body).toMatchObject({ status: 'FILLED', averageFillPrice: '69000' });
    await reconciled(t, id);
  });

  test('a LIMIT already marketable fills at once at the touch (taker), never worse than the limit', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '69999', ask: '70001' });
    const o = (await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '71000' }))).body;
    expect(o).toMatchObject({ status: 'FILLED', averageFillPrice: '70001' });
    const sell = (await c.post('/api/v1/paper/orders', order(id, { side: 'SELL', type: 'LIMIT', quantity: '0.01', price: '69000' }))).body;
    expect(sell).toMatchObject({ status: 'FILLED', averageFillPrice: '69999' });
  });

  test('LIMIT SELL fills when the bid rises to it; IOC limits that cannot fill expire', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'MARKET', quantity: '0.01' }));
    const tp = (await c.post('/api/v1/paper/orders', order(id, { side: 'SELL', type: 'LIMIT', quantity: '0.01', price: '72000', reduceOnly: true }))).body;
    expect(tp).toMatchObject({ status: 'OPEN', reservedAmount: '0' });
    await tickAndProcess(t, 'BTCUSDT', '72000', { bid: '72000', ask: '72000.01' });
    expect((await c.get(`/api/v1/paper/orders/${tp.id}`)).body).toMatchObject({ status: 'FILLED', averageFillPrice: '72000' });
    const ioc = (await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '60000', timeInForce: 'IOC' }))).body;
    expect(ioc).toMatchObject({ status: 'EXPIRED', reservedAmount: '0' });
    await reconciled(t, id);
  });

  test('STOP_MARKET BUY triggers on a rise; SELL on a fall; both fill like market orders through gaps', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'STOP_MARKET', quantity: '0.01', stopPrice: '69000' }))).body.code).toBe('INVALID_ORDER'); // would trigger now
    const buyStop = (await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'STOP_MARKET', quantity: '0.01', stopPrice: '71000' }))).body;
    await tickAndProcess(t, 'BTCUSDT', '70999.99', { bid: '70999.99', ask: '70999.99' });
    expect((await c.get(`/api/v1/paper/orders/${buyStop.id}`)).body.status).toBe('OPEN');
    await tickAndProcess(t, 'BTCUSDT', '72000', { bid: '72000', ask: '72000' }); // gapped through 71000
    const filled = (await c.get(`/api/v1/paper/orders/${buyStop.id}`)).body;
    expect(filled).toMatchObject({ status: 'FILLED', averageFillPrice: '72036' }); // 72000 × 1.0005
    expect(filled.triggeredAt).not.toBeNull();
    const sellStop = (await c.post('/api/v1/paper/orders', order(id, { side: 'SELL', type: 'STOP_MARKET', quantity: '0.01', stopPrice: '70000', reduceOnly: true }))).body;
    await tickAndProcess(t, 'BTCUSDT', '69000', { bid: '69000', ask: '69000' });
    expect((await c.get(`/api/v1/paper/orders/${sellStop.id}`)).body).toMatchObject({ status: 'FILLED', averageFillPrice: '68965.5' });
    await reconciled(t, id);
  });

  test('cancelling releases the reservation; filled orders cannot be cancelled', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    const o = (await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '60000' }))).body;
    expect((await c.get(`/api/v1/paper/accounts/${id}`)).body.reservedBalance).toBe('600.6');
    expect((await c.post(`/api/v1/paper/orders/${o.id}/cancel`)).body.status).toBe('CANCELLED');
    expect((await c.get(`/api/v1/paper/accounts/${id}`)).body).toMatchObject({ reservedBalance: '0', availableBalance: '10000' });
    expect((await c.post(`/api/v1/paper/orders/${o.id}/cancel`)).body.code).toBe('NOT_CANCELLABLE');
    await reconciled(t, id);
  });

  test('order rate limit per account', async () => {
    const id = await freshAccount();
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.0001', price: '50000' }))).status);
    expect(statuses.slice(0, 30).every(s => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
    t.clock.advance(61); // the window rolls over
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    expect((await c.post('/api/v1/paper/orders', order(id, { side: 'BUY', type: 'LIMIT', quantity: '0.0001', price: '50000' }))).status).toBe(201);
  });
});

describe('ownership and API conventions', () => {
  beforeAll(() => { c = main; });
  test('other users see nothing and can touch nothing', async () => {
    tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
    const o = (await c.post('/api/v1/paper/orders', order(accountId, { side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '60000' }))).body;
    const other = (await activeUser(t)).c;
    for (const path of [`/api/v1/paper/accounts/${accountId}`, `/api/v1/paper/accounts/${accountId}/portfolio`, `/api/v1/paper/accounts/${accountId}/transactions`, `/api/v1/paper/orders/${o.id}`]) {
      expect((await other.get(path)).status).toBe(404);
    }
    expect((await other.post(`/api/v1/paper/orders/${o.id}/cancel`)).status).toBe(404);
    expect((await other.post('/api/v1/paper/orders', order(accountId, { side: 'BUY', type: 'MARKET', quantity: '0.01' }))).status).toBe(404);
    expect((await other.patch(`/api/v1/paper/accounts/${accountId}`, { status: 'PAUSED' })).status).toBe(404);
    expect((await other.get('/api/v1/paper/orders')).body.total).toBe(0);
    expect((await c.post(`/api/v1/paper/orders/${o.id}/cancel`)).status).toBe(200);
  });

  test('authentication and phone verification are required', async () => {
    expect((await client(t.app).get('/api/v1/paper/accounts')).status).toBe(401);
    const { pendingUser } = await import('../helpers/users');
    expect((await (await pendingUser(t)).c.get('/api/v1/paper/accounts')).status).toBe(403);
  });

  test('list endpoints paginate', async () => {
    const page = (await c.get(`/api/v1/paper/orders?accountId=${accountId}&limit=1&offset=0`)).body;
    expect(page).toMatchObject({ limit: 1, offset: 0, orders: [expect.any(Object)] });
    expect((await c.get('/api/v1/paper/orders?limit=1000')).status).toBe(400);
    expect((await t.db.select().from(paperOrders).where(eq(paperOrders.paperAccountId, accountId))).length).toBe(page.total);
  });
});

test('ledger rows exist for every account touched in this file', async () => {
  expect((await t.db.select().from(paperTransactions)).length).toBeGreaterThan(20);
});
