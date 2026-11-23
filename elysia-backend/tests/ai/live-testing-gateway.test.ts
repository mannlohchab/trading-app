import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { paperAccounts, paperOrders, strategies, strategyVersions } from '../../src/db/schema';
import { createLiveTestingGateway, liveStartSchema, type LiveTestingGateway } from '../../src/modules/ai/infrastructure/live-testing.gateway';
import { strategyDefinitionSchema } from '../../src/modules/strategies/domain/definition';
import { activeUser } from '../helpers/users';
import { definition, ScriptedSignals, setup, tick, type App, type Http } from '../paper-trading/fixtures';

let t: App, c: Http, userId: string, accountId: string, strategyId: string, versionId: string, gateway: LiveTestingGateway;
let otherId: string, otherAccountId: string;
const scripted = new ScriptedSignals();
const draft = (overrides: Record<string, unknown> = {}) => ({ name: 'AI live EMA test', definition: strategyDefinitionSchema.parse(definition(overrides)) });
const counts = async () => ({ accounts: (await t.db.select().from(paperAccounts).where(eq(paperAccounts.userId, userId))).length, strategies: (await t.db.select().from(strategies).where(eq(strategies.userId, userId))).length });

beforeAll(async () => {
  const setupResult = await setup({ signalEngine: scripted });
  ({ t, c } = setupResult); userId = setupResult.user.id; accountId = setupResult.account.id;
  gateway = createLiveTestingGateway({ paper: t.paperTrading.services, strategies: t.strategies.service });
  const saved = (await c.post('/api/v1/strategies', draft())).body;
  strategyId = saved.id; versionId = saved.versionId;
  const other = await activeUser(t); otherId = other.user.id;
  otherAccountId = (await other.c.post('/api/v1/paper/accounts', { name: 'Other account' })).body.id;
});
afterAll(() => t.close());

test('starts a saved version with requested interval, sizing and costs; no historical orders are created', async () => {
  const started = await gateway.start(userId, { strategyId, strategyVersionId: versionId, accountId, timeframe: '15m', positionSizing: { type: 'percent_of_equity', value: '7' }, execution: { commissionPercent: '0.2', slippageBps: 9 } });
  expect(started).toMatchObject({ simulated: true, executionMode: 'PAPER_LIVE', status: 'CREATED', strategyVersionId: versionId, timeframe: '15m', positionSizing: { value: '7' }, execution: { commissionPercent: '0.2', slippageBps: 9 }, protective: { stopLossPercent: 5 } });
  await t.paperTrading.services.strategies.evaluate(started.id);
  const running = await gateway.get(userId, started.id);
  expect(running.status).toBe('RUNNING');
  expect(running.recentSignals).toEqual([]);
  expect(scripted.calls).toEqual([]);
  expect(await t.db.select().from(paperOrders).where(eq(paperOrders.strategyInstanceId, started.id))).toHaveLength(0);
  expect((await gateway.list(userId, { status: 'RUNNING' })).strategies.map(i => i.id)).toContain(started.id);
  expect((await gateway.control(userId, { instanceId: started.id, action: 'pause' })).status).toBe('PAUSED');
  expect((await gateway.control(userId, { instanceId: started.id, action: 'resume' })).status).toBe('RUNNING');
  expect((await gateway.control(userId, { instanceId: started.id, action: 'stop' })).status).toBe('STOPPED');
});

test('a requested new virtual account and draft are persisted while symbol/timeframe overrides preserve rules', async () => {
  const started = await gateway.start(userId, { draft: draft(), newAccount: { name: 'AI forward test', initialBalance: '25000' }, symbol: 'ETHUSDT', timeframe: '5m' });
  const saved = await t.strategies.service.get(userId, started.strategyId!);
  expect(saved!.definition).toEqual(draft().definition);
  expect(started).toMatchObject({ symbol: 'ETHUSDT', timeframe: '5m', protective: { stopLossPercent: 5 } });
  const account = await t.paperTrading.services.accounts.get(userId, started.accountId);
  expect(account).toMatchObject({ name: 'AI forward test', initialBalance: '25000', ledgerReconciled: true });
  const report = await gateway.account(userId, { accountId: started.accountId });
  expect(report).toMatchObject({ simulated: true, section: 'summary', summary: { totalEquity: '25000', unpricedSymbols: [] } });
  await gateway.control(userId, { instanceId: started.id, action: 'stop' });
});

test('unsupported automated rules fail before creating either a virtual account or strategy', async () => {
  const before = await counts();
  const base = draft().definition;
  const variants = [
    draft({ direction: 'SHORT' }),
    draft({ entry: { ...base.entry, pyramiding: 2 } }),
    draft({ exit: { ...base.exit, trailingStop: { activationPercent: 1, offsetPercent: 1 } } }),
    draft({ exit: { ...base.exit, partialTakeProfits: [{ profitPercent: 2, quantityPercent: 50 }] } }),
  ];
  for (const value of variants) {
    await expect(gateway.start(userId, { draft: value, newAccount: { name: 'Must not be created', initialBalance: '10000' } })).rejects.toThrow('historical-only');
  }
  expect(await counts()).toEqual(before);
});

test('ownership is checked before draft saves and is enforced on all instance/account reads and controls', async () => {
  const before = await counts();
  await expect(gateway.start(userId, { draft: draft(), accountId: otherAccountId })).rejects.toThrow('not found');
  await expect(gateway.start(otherId, { strategyId, newAccount: { name: 'Not created', initialBalance: '10000' } })).rejects.toThrow('not found');
  expect(await counts()).toEqual(before);
  const instance = await gateway.start(userId, { strategyId, accountId });
  await expect(gateway.get(otherId, instance.id)).rejects.toThrow('not found');
  await expect(gateway.control(otherId, { instanceId: instance.id, action: 'stop' })).rejects.toThrow('not found');
  for (const section of ['summary', 'orders', 'positions', 'trades', 'transactions'] as const) {
    await expect(gateway.account(otherId, { accountId, section })).rejects.toThrow('not found');
  }
  expect((await gateway.listAccounts(otherId)).accounts.every(a => a.id !== accountId)).toBe(true);
  await gateway.control(userId, { instanceId: instance.id, action: 'stop' });
});

test('historical saved versions are checked independently of a newer incompatible strategy version', async () => {
  await t.db.insert(strategyVersions).values({ strategyId, version: 2, definition: draft({ direction: 'SHORT' }).definition, riskSettings: { positionSizePercent: 20 }, engineVersion: 'v1' });
  const before = await counts();
  await expect(gateway.start(userId, { strategyId, newAccount: { name: 'No short live', initialBalance: '10000' } })).rejects.toThrow('historical-only');
  expect(await counts()).toEqual(before);
  const started = await gateway.start(userId, { strategyId, strategyVersionId: versionId, accountId });
  expect(started.strategyVersionId).toBe(versionId);
  await gateway.control(userId, { instanceId: started.id, action: 'stop' });
});

test('reports read real virtual-account orders and marked positions with bounded pages', async () => {
  const account = await gateway.createAccount(userId, { name: 'Paper report', initialBalance: '10000' });
  tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
  const placed = await c.post('/api/v1/paper/orders', { accountId: account.id, symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' });
  expect(placed.status).toBe(201);
  tick(t, 'BTCUSDT', '71000', { bid: '71000', ask: '71000' });
  const summary = await gateway.account(userId, { accountId: account.id, section: 'summary' });
  expect(summary).toMatchObject({ simulated: true, summary: { unpricedSymbols: [], openPositions: [{ markPrice: '71000' }] } });
  const orders = await gateway.account(userId, { accountId: account.id, section: 'orders', limit: 1 });
  expect(orders).toMatchObject({ total: 1, limit: 1, orders: [{ status: 'FILLED' }] });
  expect((await gateway.account(userId, { accountId: account.id, section: 'transactions', limit: 1 }))).toMatchObject({ limit: 1, offset: 0 });
  await expect(gateway.account(userId, { accountId: account.id, limit: 51 })).rejects.toThrow();
});

test('ambiguous starts, missing explicit virtual capital and invalid controls are rejected', async () => {
  expect(liveStartSchema.safeParse({ strategyId, draft: draft(), accountId }).success).toBe(false);
  expect(liveStartSchema.safeParse({ strategyId, accountId, newAccount: { name: 'Extra', initialBalance: '10000' } }).success).toBe(false);
  expect(liveStartSchema.safeParse({ strategyId, newAccount: { name: 'No capital' } }).success).toBe(false);
  await expect(gateway.createAccount(userId, { name: 'Too much', initialBalance: '10000001' })).rejects.toThrow();
  await expect(gateway.control(userId, { instanceId: crypto.randomUUID(), action: 'pause', closePosition: true })).rejects.toThrow('only when stopping');
});

test('stopping with stale prices reports the stopped strategy and the position that could not close', async () => {
  const account = await gateway.createAccount(userId, { name: 'Stale close', initialBalance: '10000' });
  tick(t, 'BTCUSDT', '70000', { bid: '70000', ask: '70000' });
  expect((await c.post('/api/v1/paper/orders', { accountId: account.id, symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' })).status).toBe(201);
  const instance = await gateway.start(userId, { strategyId, strategyVersionId: versionId, accountId: account.id });
  t.paperTrading.services.quotes.invalidate('BINANCE');
  t.provider.down = true;
  try {
    const stopped = await gateway.control(userId, { instanceId: instance.id, action: 'stop', closePosition: true });
    expect(stopped).toMatchObject({ status: 'STOPPED', warning: { code: 'STALE_PRICE' }, control: { closePositionRequested: true } });
    const report = await gateway.account(userId, { accountId: account.id, section: 'summary' });
    expect(report).toMatchObject({ summary: { unpricedSymbols: ['BTCUSDT'], openPositions: [{ status: 'OPEN', markPrice: null, unrealizedPnl: null }] } });
  } finally { t.provider.down = false; }
});
