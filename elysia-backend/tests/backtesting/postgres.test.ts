import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { backgroundJobs, backtestJobs, backtestResults, exchanges, strategies, strategyVersions, tradingSymbols, users } from '../../src/db/schema';
import { fullSchema, type AppDatabase } from '../../src/db/types';
import { BacktestingRepository } from '../../src/modules/backtesting/backtesting.repository';
import { BacktestError } from '../../src/modules/backtesting/backtesting.errors';
import { PostgresJobQueue } from '../../src/modules/system/jobs';
import { computeMetrics } from '../../src/modules/backtesting/utils/metrics';

const url = process.env.BACKTEST_DATABASE_URL;
describe.skipIf(!url)('backtesting with concurrent PostgreSQL connections', () => {
  let client: ReturnType<typeof postgres>, db: AppDatabase, repo: BacktestingRepository, queue: PostgresJobQueue;
  let userId: string, versionId: string, symbolId: string;
  beforeAll(async () => {
    if (!new URL(url!).pathname.includes('backtest_test')) throw new Error('BACKTEST_DATABASE_URL must name a disposable backtest_test database.');
    client = postgres(url!, { max: 12, onnotice: () => {} });
    db = drizzle(client, { schema: fullSchema, casing: 'snake_case' }) as unknown as AppDatabase;
    await migrate(db as never, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
    repo = new BacktestingRepository(db); queue = new PostgresJobQueue(db);
    const [user] = await db.insert(users).values({ email: `backtest-${crypto.randomUUID()}@example.com` }).returning(); userId = user!.id;
    const [exchange] = await db.select().from(exchanges).where(eq(exchanges.code, 'BINANCE'));
    const [symbol] = await db.insert(tradingSymbols).values({ exchangeId: exchange!.id, symbol: `BT${crypto.randomUUID().slice(0, 8)}`, baseAsset: 'BT', quoteAsset: 'USDT', priceTickSize: '0.01', quantityStepSize: '1' }).returning(); symbolId = symbol!.id;
    const [strategy] = await db.insert(strategies).values({ userId, name: 'Concurrency test', source: 'USER_CREATED' }).returning();
    const [version] = await db.insert(strategyVersions).values({ strategyId: strategy!.id, version: 1, definition: {}, engineVersion: 'test' }).returning(); versionId = version!.id;
  });
  afterAll(async () => { await client?.end(); });

  test('twelve workers claim each queued job only once', async () => {
    const type = `backtest.concurrent.${crypto.randomUUID().slice(0, 8)}`;
    const jobs = await Promise.all(Array.from({ length: 8 }, () => queue.enqueue({ type, payload: {} })));
    const claimed = await Promise.all(Array.from({ length: 12 }, (_, i) => queue.claim([type], `worker-${i}`)));
    expect(new Set(claimed.filter(Boolean).map(j => j!.id)).size).toBe(8);
    expect(claimed.filter(Boolean)).toHaveLength(jobs.length);
    const [{ connections }] = await client`select count(*)::int as connections from pg_stat_activity where datname = current_database()`;
    expect(connections).toBeGreaterThan(1);
  });

  test('a queue insertion failure rolls back creation of the backtest', async () => {
    const id = crypto.randomUUID();
    await expect(repo.create({ id, userId, strategyVersionId: versionId, symbolId, timeframe: '1h', startTime: 0, endTime: 3_600_000, initialBalance: '100' }, async () => { throw new Error('queue unavailable'); })).rejects.toThrow();
    expect(await repo.get(id)).toBeNull();
  });

  test('concurrent result writers and cancellation produce one atomic outcome', async () => {
    const row = await repo.create({ userId, strategyVersionId: versionId, symbolId, timeframe: '1h', startTime: 0, endTime: 3_600_000, initialBalance: '100' }, async () => {});
    await repo.markRunning(row.id, new Date());
    const candle = { openTime: 0, closeTime: 3_599_999, open: '100', high: '100', low: '100', close: '100', volume: '1' };
    const metrics = computeMetrics({ engine: { name: 'test', version: '1', revision: '1' }, trades: [], equity: ['100'], realizedPnl: '0', openPosition: null, durationMs: 1 }, [candle], '100');
    const result = { metrics, trades: [], equityCurve: [{ time: 0, equity: '100' }], warnings: [], engineDurationMs: 1,
      dataset: { candles: 1, expectedCandles: 1, missingCandles: 0, firstOpenTime: 0, lastCloseTime: 3_599_999, checksum: '0'.repeat(64), source: 'market_candles' as const } };
    await Promise.all([...Array.from({ length: 5 }, () => repo.saveResult(row, {}, symbolId, result)), repo.cancel(userId, row.id, async () => {})]);
    const completed = (await repo.get(row.id))!.status === 'COMPLETED';
    const results = await db.select().from(backtestResults).where(eq(backtestResults.backtestJobId, row.id));
    expect(results).toHaveLength(completed ? 1 : 0);
    expect(['COMPLETED', 'CANCELLED']).toContain((await repo.get(row.id))!.status);
  });

  test('concurrent creates and replays share an atomic three-active admission limit', async () => {
    const type = `backtest.admission.${crypto.randomUUID().slice(0, 8)}`;
    const create = () => {
      const id = crypto.randomUUID();
      return repo.create({ id, userId, strategyVersionId: versionId, symbolId, timeframe: '1h', startTime: 0, endTime: 3_600_000, initialBalance: '100' },
        tx => queue.enqueue({ type, payload: { backtestJobId: id } }, tx));
    };
    // Both public create and replay call this same repository admission path.
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, create));
    const accepted = outcomes.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof create>>> => r.status === 'fulfilled');
    const rejected = outcomes.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(9);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(BacktestError);
      expect(result.reason.code).toBe('TOO_MANY_ACTIVE');
    }
    expect(await repo.countActive(userId)).toBe(3);
    expect(await db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, type))).toHaveLength(3);
    await repo.cancel(userId, accepted[0]!.value.id, async () => {});
    const replacement = await create();
    expect(replacement.status).toBe('PENDING');
    expect(await repo.countActive(userId)).toBe(3);
    expect(await db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, type))).toHaveLength(4);
    await db.update(backtestJobs).set({ status: 'CANCELLED' }).where(and(eq(backtestJobs.userId, userId), inArray(backtestJobs.status, ['PENDING', 'RUNNING'])));
  });
});
