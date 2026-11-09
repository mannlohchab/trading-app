// All database access for backtesting. Reads strategy and market tables read-only; owns
// backtest_jobs, backtest_results and backtest_trades.
import { and, count, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  backtestJobs, backtestResults, backtestTrades, exchanges, marketCandles, strategies, strategyVersions, tradingSymbols,
} from '../../db/schema';
import type { AppDatabase } from '../../db/types';
import type { Timeframe } from '../market/domain/market-options';
import type { BacktestMetrics, BacktestWarning, DatasetCandle, DatasetInfo, EngineTrade, SymbolSpec } from './backtesting.types';
import { dec } from './utils/decimal';

export type JobRow = typeof backtestJobs.$inferSelect;
export type BacktestStatus = JobRow['status'];
type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export type StoredResult = {
  metrics: BacktestMetrics;
  trades: EngineTrade[];
  equityCurve: { time: number; equity: string }[];
  warnings: BacktestWarning[];
  dataset: DatasetInfo;
  engineDurationMs: number;
};

const CHUNK = 500;
const normalize = (v: string | null) => (v === null ? null : dec.from(v));

export class BacktestingRepository {
  constructor(private readonly db: AppDatabase) {}

  // ---- Strategies and market (read-only) -------------------------------------------------------

  /** The user's strategy and an exact version (latest when not given). Null if not theirs. */
  async findStrategyVersion(userId: string, strategyId: string, versionId?: string) {
    const rows = await this.db
      .select({ strategy: strategies, version: strategyVersions })
      .from(strategyVersions)
      .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
      .where(and(
        eq(strategies.id, strategyId),
        eq(strategies.userId, userId),
        ne(strategies.status, 'DELETED'),
        versionId ? eq(strategyVersions.id, versionId) : undefined,
      ))
      .orderBy(desc(strategyVersions.version))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      strategyId: row.strategy.id,
      name: row.strategy.name,
      versionId: row.version.id,
      version: row.version.version,
      engineVersion: row.version.engineVersion,
      // The strategies module stores risk settings in their own column.
      definition: { ...row.version.definition, risk: row.version.riskSettings } as Record<string, unknown>,
    };
  }

  async findInstrument(exchange: string, symbol: string): Promise<(SymbolSpec & { id: string }) | null> {
    const [row] = await this.db
      .select({ s: tradingSymbols, code: exchanges.code })
      .from(tradingSymbols)
      .innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(and(eq(exchanges.code, exchange), eq(tradingSymbols.symbol, symbol), eq(tradingSymbols.isActive, true)));
    if (!row || !row.s.priceTickSize || !row.s.quantityStepSize) return null;
    return {
      id: row.s.id, exchange: row.code, symbol: row.s.symbol, baseAsset: row.s.baseAsset, quoteAsset: row.s.quoteAsset,
      tickSize: dec.from(row.s.priceTickSize), lotSize: dec.from(row.s.quantityStepSize),
    };
  }

  /** Stored candles whose open time is in [start, end), oldest first. */
  async loadCandles(symbolId: string, timeframe: Timeframe, start: number, end: number): Promise<(DatasetCandle & { isClosed: boolean })[]> {
    const rows = await this.db.select().from(marketCandles)
      .where(and(eq(marketCandles.symbolId, symbolId), eq(marketCandles.timeframe, timeframe), gte(marketCandles.openTime, start), lt(marketCandles.openTime, end)))
      .orderBy(marketCandles.openTime);
    return rows.map(r => ({
      openTime: r.openTime, closeTime: r.closeTime, isClosed: r.isClosed,
      open: dec.from(r.open), high: dec.from(r.high), low: dec.from(r.low), close: dec.from(r.close), volume: dec.from(r.volume),
    }));
  }

  async countCandles(symbolId: string, timeframe: Timeframe, start: number, end: number) {
    const [row] = await this.db.select({ n: count() }).from(marketCandles)
      .where(and(eq(marketCandles.symbolId, symbolId), eq(marketCandles.timeframe, timeframe), gte(marketCandles.openTime, start), lt(marketCandles.openTime, end), eq(marketCandles.isClosed, true)));
    return row?.n ?? 0;
  }

  // ---- Jobs ----------------------------------------------------------------------------------

  async countActive(userId: string) {
    const [row] = await this.db.select({ n: count() }).from(backtestJobs)
      .where(and(eq(backtestJobs.userId, userId), inArray(backtestJobs.status, ['PENDING', 'RUNNING'])));
    return row?.n ?? 0;
  }

  /** Inserts the backtest and runs `enqueue` in the same transaction. */
  async create(values: typeof backtestJobs.$inferInsert, enqueue: (tx: Tx) => Promise<unknown>): Promise<JobRow> {
    return this.db.transaction(async tx => {
      const [row] = await tx.insert(backtestJobs).values(values).returning();
      await enqueue(tx);
      return row!;
    });
  }

  async get(id: string) {
    const [row] = await this.db.select().from(backtestJobs).where(eq(backtestJobs.id, id));
    return row ?? null;
  }

  async getForUser(userId: string, id: string) {
    const [row] = await this.db.select().from(backtestJobs).where(and(eq(backtestJobs.id, id), eq(backtestJobs.userId, userId)));
    return row ?? null;
  }

  async status(id: string): Promise<BacktestStatus | null> {
    const [row] = await this.db.select({ status: backtestJobs.status }).from(backtestJobs).where(eq(backtestJobs.id, id));
    return row?.status ?? null;
  }

  /** PENDING → RUNNING (or keeps RUNNING when a crashed attempt is retried). */
  async markRunning(id: string, startedAt: Date) {
    const [row] = await this.db.update(backtestJobs)
      .set({ status: 'RUNNING', startedAt, errorMessage: null })
      .where(and(eq(backtestJobs.id, id), inArray(backtestJobs.status, ['PENDING', 'RUNNING'])))
      .returning();
    return row ?? null;
  }

  async markFailed(id: string, message: string, configuration?: Record<string, unknown>) {
    const rows = await this.db.update(backtestJobs)
      .set({ status: 'FAILED', errorMessage: message.slice(0, 2000), completedAt: sql`now()`, ...(configuration && { configuration }) })
      .where(and(eq(backtestJobs.id, id), inArray(backtestJobs.status, ['PENDING', 'RUNNING'])))
      .returning({ id: backtestJobs.id });
    return rows.length > 0;
  }

  /** Marks the user's PENDING/RUNNING backtest CANCELLED; `alsoInTx` runs in the same transaction. */
  async cancel(userId: string, id: string, alsoInTx: (tx: Tx, row: JobRow) => Promise<unknown>) {
    return this.db.transaction(async tx => {
      const [row] = await tx.update(backtestJobs)
        .set({ status: 'CANCELLED', completedAt: sql`now()` })
        .where(and(eq(backtestJobs.id, id), eq(backtestJobs.userId, userId), inArray(backtestJobs.status, ['PENDING', 'RUNNING'])))
        .returning();
      if (row) await alsoInTx(tx, row);
      return row ?? null;
    });
  }

  /**
   * Persists a finished run: RUNNING → COMPLETED, summary, trades and equity curve in one
   * transaction. Returns false (and writes nothing) if the backtest is no longer RUNNING,
   * e.g. it was cancelled or another attempt already finished it.
   */
  async saveResult(job: JobRow, configuration: Record<string, unknown>, symbolId: string, result: StoredResult): Promise<boolean> {
    return this.db.transaction(async tx => {
      const claimed = await tx.update(backtestJobs)
        .set({ status: 'COMPLETED', completedAt: sql`now()`, configuration })
        .where(and(eq(backtestJobs.id, job.id), eq(backtestJobs.status, 'RUNNING')))
        .returning({ id: backtestJobs.id });
      if (!claimed.length) return false;

      const m = result.metrics;
      const [summary] = await tx.insert(backtestResults).values({
        backtestJobId: job.id,
        finalBalance: m.finalEquity,
        netProfit: m.netProfit,
        totalReturn: dec.round(m.totalReturnPercent, 8),
        winRate: m.winRatePercent === null ? null : dec.round(m.winRatePercent, 8),
        profitFactor: m.profitFactor,
        maxDrawdown: m.maxDrawdownPercent,
        totalTrades: m.totalTrades,
        winningTrades: m.winningTrades,
        losingTrades: m.losingTrades,
        averageProfit: m.averageWinningTrade,
        averageLoss: m.averageLosingTrade,
        metrics: { ...m, warnings: result.warnings, dataset: result.dataset, engineDurationMs: Math.round(result.engineDurationMs), equityCurve: result.equityCurve },
      }).returning({ id: backtestResults.id });

      for (let i = 0; i < result.trades.length; i += CHUNK) {
        await tx.insert(backtestTrades).values(result.trades.slice(i, i + CHUNK).map(t => ({
          backtestResultId: summary!.id,
          symbolId,
          side: t.side,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          quantity: t.quantity,
          profitLoss: t.profit,
          fees: t.commission,
          exitReason: t.exitReason.slice(0, 50),
          metadata: { profitPercent: t.profitPercent, maxRunup: t.maxRunup, maxDrawdown: t.maxDrawdown, entryId: t.entryId, exitId: t.exitId },
        })));
      }
      return true;
    });
  }

  // ---- Reads for the API ---------------------------------------------------------------------

  async list(userId: string, opts: { limit: number; before?: Date; status?: BacktestStatus; strategyId?: string }) {
    const rows = await this.db
      .select({ job: backtestJobs, result: backtestResults })
      .from(backtestJobs)
      .leftJoin(backtestResults, eq(backtestResults.backtestJobId, backtestJobs.id))
      .innerJoin(strategyVersions, eq(strategyVersions.id, backtestJobs.strategyVersionId))
      .where(and(
        eq(backtestJobs.userId, userId),
        opts.before ? lt(backtestJobs.createdAt, opts.before) : undefined,
        opts.status ? eq(backtestJobs.status, opts.status) : undefined,
        opts.strategyId ? eq(strategyVersions.strategyId, opts.strategyId) : undefined,
      ))
      .orderBy(desc(backtestJobs.createdAt))
      .limit(opts.limit);
    return rows;
  }

  async result(jobId: string) {
    const [row] = await this.db.select().from(backtestResults).where(eq(backtestResults.backtestJobId, jobId));
    return row ?? null;
  }

  async trades(jobId: string, limit: number, offset: number) {
    const result = await this.result(jobId);
    if (!result) return { total: 0, trades: [] };
    const [rows, [total]] = await Promise.all([
      this.db.select().from(backtestTrades).where(eq(backtestTrades.backtestResultId, result.id))
        .orderBy(backtestTrades.entryTime, backtestTrades.id).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(backtestTrades).where(eq(backtestTrades.backtestResultId, result.id)),
    ]);
    return {
      total: total?.n ?? 0,
      trades: rows.map(r => ({
        id: r.id, side: r.side, entryTime: r.entryTime, exitTime: r.exitTime,
        entryPrice: dec.from(r.entryPrice), exitPrice: normalize(r.exitPrice), quantity: dec.from(r.quantity),
        profit: normalize(r.profitLoss), fees: dec.from(r.fees), exitReason: r.exitReason, ...r.metadata,
      })),
    };
  }
}
