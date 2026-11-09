// Concurrency on a REAL PostgreSQL server (PGlite has one connection and serializes everything).
// Run with an empty, disposable database:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/paper_test bun test tests/paper-trading/postgres-concurrency.test.ts
// The test migrates it and deletes what it creates; never point it at a database you care about.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { exchanges, paperOrders, paperTransactions, tradingSymbols, users } from '../../src/db/schema';
import { fullSchema, type AppDatabase } from '../../src/db/types';
import { JSON_OID, parseJsonLossless } from '../../src/db/json';
import { silentLogger } from '../../src/logger';
import { createPaperTradingServices } from '../../src/modules/paper-trading/paper-trading.service';
import { PostgresJobQueue } from '../../src/modules/system/jobs';
import type { Quote } from '../../src/modules/paper-trading/paper-trading.types';

const url = process.env.TEST_DATABASE_URL;
if (!url) console.warn('[postgres-concurrency] TEST_DATABASE_URL not set: real-PostgreSQL concurrency tests skipped');

describe.skipIf(!url)('real PostgreSQL concurrency', () => {
  let client: ReturnType<typeof postgres>;
  let db: AppDatabase;
  let services: ReturnType<typeof createPaperTradingServices>;
  let userId: string;
  const now = new Date();
  let quote: Quote;

  beforeAll(async () => {
    client = postgres(url!, { max: 12, onnotice: () => {}, types: { json: { to: JSON_OID, from: [JSON_OID], serialize: JSON.stringify, parse: parseJsonLossless } } });
    db = drizzle(client, { schema: fullSchema, casing: 'snake_case' }) as unknown as AppDatabase;
    await migrate(db as never, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
    const [binance] = await db.select().from(exchanges).where(eq(exchanges.code, 'BINANCE'));
    await db.insert(tradingSymbols).values({ exchangeId: binance!.id, symbol: 'PGTESTUSDT', baseAsset: 'PGTEST', quoteAsset: 'USDT', priceTickSize: '0.01', quantityStepSize: '0.001', metadata: { minNotional: '1' } }).onConflictDoNothing();
    const [u] = await db.insert(users).values({ email: `pg-${crypto.randomUUID()}@example.com` }).returning();
    userId = u!.id;
    quote = { last: '1000', bid: '1000', ask: '1000', time: now.getTime(), source: 'stream' };
    const market = { tickersFor: async () => [] } as never;
    services = createPaperTradingServices({ db, market, signals: { identity: { name: 'x', version: 'x', revision: 'x' }, signals: async () => { throw new Error('unused'); } }, queue: new PostgresJobQueue(db), clock: { now: () => new Date() }, log: silentLogger });
    // Prices come from this fixed fresh quote.
    services.quotes.quote = async () => ({ ...quote, time: Date.now() });
  });

  afterAll(async () => {
    if (!client) return;
    await db.transaction(async tx => {
      await tx.execute(dsql`SET LOCAL paper.ledger_purge = 'on'`);
      await tx.delete(users).where(eq(users.id, userId)); // cascades accounts, orders, positions, ledger
    });
    await db.delete(tradingSymbols).where(eq(tradingSymbols.symbol, 'PGTESTUSDT'));
    await client.end();
  });

  test('20 concurrent orders on 12 connections cannot overspend one account', async () => {
    const account = await services.accounts.create(userId, { name: 'race', initialBalance: '1000' });
    // Each reserves 0.3 × 1000 + fee = 300.3: exactly three fit.
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      services.orders.place(userId, { accountId: account.id, symbol: 'PGTESTUSDT', side: 'BUY', type: 'LIMIT', quantity: '0.3', price: '1000', idempotencyKey: `race-${i}` })));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const insufficient = results.filter(r => r.status === 'rejected' && (r.reason as { code?: string }).code === 'INSUFFICIENT_BALANCE').length;
    expect([ok, insufficient]).toEqual([3, 17]);
    const rec = await services.accounts.reconcile(account.id);
    expect(rec.mismatches).toEqual([]);
    const [{ backends }] = await client`select count(*)::int as backends from pg_stat_activity where datname = current_database()`;
    expect(backends).toBeGreaterThan(1); // really concurrent connections
  });

  test('the same order filled from 8 connections at once is filled exactly once', async () => {
    const account = await services.accounts.create(userId, { name: 'fill', initialBalance: '10000' });
    quote = { last: '1000', bid: '1000', ask: '1000', time: Date.now(), source: 'stream' };
    const { order } = await services.orders.place(userId, { accountId: account.id, symbol: 'PGTESTUSDT', side: 'BUY', type: 'LIMIT', quantity: '1', price: '900' });
    const below = { last: '890', bid: '890', ask: '890', time: Date.now(), source: 'stream' as const };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => services.execution.fill(order.id, below)));
    expect(outcomes.filter(o => o.outcome === 'filled')).toHaveLength(1);
    expect(await db.select().from(paperTransactions).where(eq(paperTransactions.orderId, order.id)).then(r => r.filter(e => e.transactionType === 'TRADING_FEE').length)).toBe(1);
    expect((await services.accounts.reconcile(account.id)).mismatches).toEqual([]);
  });

  test('concurrent cancels and fills of one order resolve to a single outcome without deadlock', async () => {
    const account = await services.accounts.create(userId, { name: 'mixed', initialBalance: '10000' });
    const { order } = await services.orders.place(userId, { accountId: account.id, symbol: 'PGTESTUSDT', side: 'BUY', type: 'LIMIT', quantity: '1', price: '900' });
    const below = { last: '890', bid: '890', ask: '890', time: Date.now(), source: 'stream' as const };
    await Promise.allSettled([
      ...Array.from({ length: 4 }, () => services.execution.fill(order.id, below)),
      ...Array.from({ length: 4 }, () => services.orders.endIfOpen(order.id, 'CANCELLED', 'race')),
    ]);
    const [row] = await db.select().from(paperOrders).where(eq(paperOrders.id, order.id));
    expect(['FILLED', 'CANCELLED']).toContain(row!.status);
    expect((await services.accounts.reconcile(account.id)).mismatches).toEqual([]);
  });

  test('a job is claimed by exactly one of many concurrent workers', async () => {
    const queue = new PostgresJobQueue(db);
    const job = await queue.enqueue({ type: 'pgtest.race', payload: {} });
    const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => queue.claim(['pgtest.race'], `w${i}`)));
    expect(claims.filter(Boolean).map(c => c!.id)).toEqual([job.id]);
    await queue.complete(claims.find(Boolean)!);
  });

  test('the ledger rejects UPDATE and DELETE on a real server too', async () => {
    const account = await services.accounts.create(userId, { name: 'immutable', initialBalance: '500' });
    // Drizzle builders are lazy thenables, and Drizzle wraps the database error in `cause`.
    const reason = async (run: () => Promise<unknown>) => run().then(() => 'no error', (e: Error & { cause?: Error }) => e.cause?.message ?? e.message);
    expect(await reason(async () => db.update(paperTransactions).set({ amount: '1' }).where(eq(paperTransactions.paperAccountId, account.id)))).toContain('append-only (UPDATE rejected)');
    expect(await reason(async () => db.delete(paperTransactions).where(eq(paperTransactions.paperAccountId, account.id)))).toContain('append-only (DELETE rejected)');
    expect((await db.select().from(paperTransactions).where(eq(paperTransactions.paperAccountId, account.id)))[0]!.amount).toBe('500.000000000000');
  });
});
