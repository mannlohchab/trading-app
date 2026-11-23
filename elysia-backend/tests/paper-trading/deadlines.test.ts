import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { paperOrders, paperStrategyInstances } from '../../src/db/schema';
import { createLiveTestingGateway, type LiveTestingGateway } from '../../src/modules/ai/infrastructure/live-testing.gateway';
import { definition, ScriptedSignals, setup, tick, type App, type Http } from './fixtures';

let t: App, c: Http, userId: string, strategyId: string, gateway: LiveTestingGateway;
beforeAll(async () => {
  const fixture = await setup({ signalEngine: new ScriptedSignals() });
  ({ t, c } = fixture); userId = fixture.user.id;
  strategyId = (await c.post('/api/v1/strategies', { name: 'Deadline EMA', definition: definition() })).body.id;
  gateway = createLiveTestingGateway({ paper: t.paperTrading.services, strategies: t.strategies.service });
});
afterAll(() => t.close());

async function start(closePositionAtEnd = false) {
  const run = await gateway.start(userId, { strategyId, newAccount: { name: 'Timed test', initialBalance: '10000' }, durationMinutes: 1, closePositionAtEnd });
  await t.paperTrading.services.strategies.evaluate(run.id);
  return run;
}
async function enter(run: Awaited<ReturnType<typeof start>>) {
  tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
  return t.paperTrading.services.orders.place(userId, { accountId: run.accountId, symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' }, {
    source: 'STRATEGY', strategyInstanceId: run.id, strategyVersionId: run.strategyVersionId,
    metadata: { protective: { stopLossPercent: 5, takeProfitPercent: 10 } },
  });
}

test('the live clock resolves duration and a quiet-market sweep stops a paused instance while retaining protection', async () => {
  const now = t.clock.now().getTime();
  const run = await start();
  expect(run).toMatchObject({ endTime: now + 60000, closePositionAtEnd: false, termination: null });
  expect((await enter(run)).order.status).toBe('FILLED');
  await gateway.control(userId, { instanceId: run.id, action: 'pause' });
  t.clock.advance(61);
  await t.paperTrading.engine.sweep();
  expect(await gateway.get(userId, run.id)).toMatchObject({ status: 'STOPPED', termination: { reason: 'DEADLINE', closeStatus: 'NOT_REQUESTED' } });
  expect((await t.paperTrading.services.positions.list(userId, { accountId: run.accountId, status: 'OPEN', limit: 10, offset: 0 })).total).toBe(1);
  const orders = await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, run.id));
  expect(orders.filter(o => o.source === 'PROTECTIVE').map(o => o.status)).toEqual(['OPEN', 'OPEN']);
  await expect(gateway.control(userId, { instanceId: run.id, action: 'resume' })).rejects.toThrow('deadline');
});

test('an explicitly requested deadline close uses a fresh quote and cancels its protective orders', async () => {
  const run = await start(true);
  await enter(run);
  t.clock.advance(61);
  tick(t, 'BTCUSDT', '71000', { bid: '71000', ask: '71000' });
  await t.paperTrading.services.strategies.expireDueInstances();
  expect(await gateway.get(userId, run.id)).toMatchObject({ status: 'STOPPED', termination: { closeStatus: 'CLOSED' } });
  expect((await t.paperTrading.services.positions.list(userId, { accountId: run.accountId, status: 'OPEN', limit: 10, offset: 0 })).total).toBe(0);
  const orders = await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, run.id));
  expect(orders.filter(o => o.source === 'PROTECTIVE').every(o => o.status === 'CANCELLED')).toBe(true);
});

test('unavailable deadline-close quotes retain the position and persist an explicit failure instead of inventing a fill', async () => {
  const run = await start(true);
  await enter(run);
  t.clock.advance(61);
  t.paperTrading.services.quotes.invalidate('BINANCE');
  t.provider.down = true;
  try {
    await t.paperTrading.services.strategies.expireDueInstances();
    const result = await gateway.get(userId, run.id);
    expect(result).toMatchObject({ status: 'STOPPED', termination: { closeStatus: 'FAILED' } });
    expect(result.errorMessage).toContain('No fresh price');
    expect((await t.paperTrading.services.positions.list(userId, { accountId: run.accountId, status: 'OPEN', limit: 10, offset: 0 })).total).toBe(1);
  } finally { t.provider.down = false; }
  tick(t, 'BTCUSDT', '71000');
  await t.paperTrading.services.strategies.expireDueInstances();
  expect((await gateway.get(userId, run.id)).termination?.closeStatus).toBe('FAILED');
});

test('a persisted interrupted close is recovered by the next sweep', async () => {
  const run = await start(true);
  await enter(run);
  const { positions } = await t.paperTrading.services.positions.list(userId, { accountId: run.accountId, status: 'OPEN', limit: 10, offset: 0 });
  const [row] = await t.db.select().from(paperStrategyInstances).where(eq(paperStrategyInstances.id, run.id));
  t.clock.advance(61);
  await t.db.update(paperStrategyInstances).set({ status: 'STOPPED', stoppedAt: t.clock.now(), configuration: { ...row!.configuration, termination: { reason: 'DEADLINE', at: t.clock.now().getTime(), closeStatus: 'PENDING', positionId: positions[0]!.id } } }).where(eq(paperStrategyInstances.id, run.id));
  tick(t, 'BTCUSDT', '70500');
  await t.paperTrading.engine.sweep();
  expect((await gateway.get(userId, run.id)).termination?.closeStatus).toBe('CLOSED');
});

test('deadline guards reject new strategy orders and pending fills even before the periodic stop sweep', async () => {
  const run = await start();
  tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
  const pending = await t.paperTrading.services.orders.place(userId, { accountId: run.accountId, symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '65000', quantity: '0.01' }, { source: 'STRATEGY', strategyInstanceId: run.id, strategyVersionId: run.strategyVersionId });
  expect(pending.order.status).toBe('OPEN');
  t.clock.advance(61);
  tick(t, 'BTCUSDT', '65000', { bid: '65000', ask: '65000' });
  await expect(t.paperTrading.services.orders.place(userId, { accountId: run.accountId, symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' }, { source: 'STRATEGY', strategyInstanceId: run.id, strategyVersionId: run.strategyVersionId })).rejects.toThrow('deadline');
  expect(await t.paperTrading.services.execution.fill(pending.order.id, t.paperTrading.services.quotes.latest('BINANCE', 'BTCUSDT')!)).toMatchObject({ outcome: 'rejected' });
  expect((await t.paperTrading.services.accounts.get(userId, run.accountId)).reservedBalance).toBe('0');
  expect(await t.paperTrading.services.strategies.evaluate(run.id)).toEqual({ processed: 0, signal: null });
  expect((await gateway.get(userId, run.id)).status).toBe('STOPPED');
});

test('past and ambiguous deadlines fail before any virtual account is created', async () => {
  const before = (await gateway.listAccounts(userId, { limit: 50 })).total;
  for (const schedule of [{ endTime: t.clock.now().getTime() }, { endTime: t.clock.now().getTime() + 1000, durationMinutes: 1 }, { durationMinutes: 0 }, { durationMinutes: 525601 }, { closePositionAtEnd: true }]) {
    await expect(gateway.start(userId, { strategyId, newAccount: { name: 'Must not exist', initialBalance: '10000' }, ...schedule })).rejects.toThrow();
  }
  expect((await gateway.listAccounts(userId, { limit: 50 })).total).toBe(before);
});

test('an explicit timestamp is preserved and a queued instance cannot begin after that deadline', async () => {
  const end = t.clock.now().getTime() + 60000;
  const run = await gateway.start(userId, { strategyId, newAccount: { name: 'Exact end', initialBalance: '10000' }, endTime: new Date(end).toISOString() });
  expect(run.endTime).toBe(end);
  t.clock.advance(61);
  expect(await t.paperTrading.services.strategies.evaluate(run.id)).toEqual({ processed: 0, signal: null });
  expect(await gateway.get(userId, run.id)).toMatchObject({ status: 'STOPPED', startedAt: null, termination: { closeStatus: 'NOT_REQUESTED' } });
});
