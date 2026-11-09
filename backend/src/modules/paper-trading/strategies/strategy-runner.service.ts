// Automated strategies on live data: lifecycle (start/pause/resume/stop) and the evaluation job.
//
// Each RUNNING instance remembers the open time of the last closed candle it processed. An
// evaluation (a `paper.strategy.evaluate` job on background_jobs, enqueued on candle-close events
// and by a periodic sweep) evaluates everything closed since then in one sandboxed run, records the
// newest candle's signal and acts on it; older candles found while catching up are never traded.
// Progress is committed with a fence (status and last processed candle unchanged) under a row lock,
// so concurrent or repeated evaluations process each candle once.
import { createHash } from 'node:crypto';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { paperPositions, paperSignals, paperStrategyInstances, tradingSymbols } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Logger } from '../../../logger';
import { definitionToPine, dec, requiredCandles, type StrategySignalEngine } from '../../backtesting';
import { alignDown, candlesBefore, nextOpenTime, timeframeMs } from '../../backtesting/utils/validation';
import { EngineError } from '../../backtesting';
import type { Timeframe } from '../../market/domain/market-options';
import { strategyDefinitionSchema } from '../../strategies/domain/definition';
import type { JobRecord, PostgresJobQueue } from '../../system/jobs';
import { RetryableJobError } from '../../system/jobs';
import { lockAccount } from '../accounts/ledger';
import { ENGINE, EXECUTION, PAPER_CURRENCY, PAPER_EXCHANGE, STRATEGY_LIMITS } from '../paper-trading.constants';
import { PaperError } from '../paper-trading.errors';
import type { PaperTradingRepository, Tx } from '../paper-trading.repository';
import type { PositionService } from '../positions/position.service';
import { EvaluationDataError, type StrategyEvaluator } from './strategy-evaluator';
import type { SignalProcessor } from './signal-processor';

export type InstanceRow = typeof paperStrategyInstances.$inferSelect;
export type InstanceStatus = InstanceRow['status'];

const configurationSchema = z.object({
  schemaVersion: z.literal(1),
  strategy: z.object({ name: z.string(), version: z.number() }),
  script: z.object({ source: z.string(), sha256: z.string() }),
  engine: z.object({ name: z.string(), version: z.string(), revision: z.string() }),
  market: z.object({ exchange: z.string(), symbol: z.string() }),
  positionSizing: z.object({ type: z.literal('percent_of_equity'), value: z.string() }),
  execution: z.object({ commissionPercent: z.string(), slippageBps: z.number() }),
  protective: z.object({ stopLossPercent: z.number().optional(), takeProfitPercent: z.number().optional() }),
  requiredCandles: z.number().int().positive(),
  windowCandles: z.number().int().positive(),
});
export type InstanceConfiguration = z.infer<typeof configurationSchema>;

export const instanceView = (i: InstanceRow & { symbol?: string }) => {
  const c = configurationSchema.safeParse(i.configuration);
  return {
    id: i.id, status: i.status, accountId: i.paperAccountId, strategyId: i.strategyId, strategyVersionId: i.strategyVersionId,
    strategy: c.success ? c.data.strategy : null, exchange: PAPER_EXCHANGE, symbol: i.symbol ?? (c.success ? c.data.market.symbol : null), timeframe: i.timeframe,
    positionSizing: c.success ? c.data.positionSizing : null, execution: c.success ? c.data.execution : null, protective: c.success ? c.data.protective : null,
    engine: c.success ? c.data.engine : null, scriptSha256: c.success ? c.data.script.sha256 : null,
    lastProcessedCandleTime: i.lastProcessedCandleTime, lastSignalId: i.lastSignalId, errorMessage: i.errorMessage,
    createdAt: i.createdAt, startedAt: i.startedAt, pausedAt: i.pausedAt, stoppedAt: i.stoppedAt, updatedAt: i.updatedAt,
  };
};

/** Open time of the newest candle that has fully closed by `now`. */
export const latestClosedOpenTime = (tf: Timeframe, now: number) => candlesBefore(tf, alignDown(tf, now), 1);

export class StrategyRunnerService {
  readonly metrics = { started: 0, stopped: 0, failed: 0 };

  constructor(private readonly deps: {
    db: AppDatabase; repo: PaperTradingRepository; queue: PostgresJobQueue; evaluator: StrategyEvaluator; signals: SignalProcessor;
    positions: PositionService; engineIdentity: StrategySignalEngine['identity']; clock: { now(): Date }; log: Logger;
  }) {}

  // ---- Lifecycle -------------------------------------------------------------------------------

  async start(userId: string, strategyId: string, input: {
    accountId: string; strategyVersionId?: string; symbol?: string; timeframe?: Timeframe;
    positionSizing?: { type: 'percent_of_equity'; value: string }; execution?: { commissionPercent?: string; slippageBps?: number };
  }) {
    const stored = await this.deps.repo.strategyVersion(userId, strategyId, input.strategyVersionId);
    if (!stored) throw new PaperError('STRATEGY_NOT_FOUND', 'Strategy or strategy version not found.');
    const parsed = strategyDefinitionSchema.safeParse(stored.definition);
    if (!parsed.success) throw new PaperError('INVALID_STRATEGY', 'This strategy version cannot run: its definition is invalid.');
    const def = parsed.data;
    const timeframe = input.timeframe ?? def.market.timeframe;
    const rules = await this.deps.repo.symbolRules(PAPER_EXCHANGE, (input.symbol ?? def.market.symbol).toUpperCase());
    if (!rules) throw new PaperError('UNKNOWN_SYMBOL', `${input.symbol ?? def.market.symbol} is not an active ${PAPER_EXCHANGE} market.`);
    if (rules.quoteAsset !== PAPER_CURRENCY) throw new PaperError('UNKNOWN_SYMBOL', `Paper accounts trade ${PAPER_CURRENCY} pairs only; ${rules.symbol} is priced in ${rules.quoteAsset}.`);

    const source = definitionToPine(stored.name, { ...def, market: { exchange: PAPER_EXCHANGE, symbol: rules.symbol, timeframe } });
    const required = requiredCandles(def);
    const configuration: InstanceConfiguration = {
      schemaVersion: 1,
      strategy: { name: stored.name, version: stored.version },
      script: { source, sha256: createHash('sha256').update(source).digest('hex') },
      engine: { ...this.deps.engineIdentity },
      market: { exchange: PAPER_EXCHANGE, symbol: rules.symbol },
      positionSizing: input.positionSizing ?? { type: 'percent_of_equity', value: dec.from(String(def.risk.positionSizePercent)) },
      execution: { commissionPercent: dec.from(input.execution?.commissionPercent ?? EXECUTION.commissionPercent), slippageBps: input.execution?.slippageBps ?? EXECUTION.slippageBps },
      protective: { stopLossPercent: def.exit.stopLossPercent, takeProfitPercent: def.exit.takeProfitPercent },
      requiredCandles: required,
      // Long enough for recursive indicators (EMA, RSI) to converge to the backtest's values.
      windowCandles: Math.min(1000, Math.max(500, required * 4)),
    };

    const row = await this.deps.db.transaction(async tx => {
      const account = await lockAccount(tx, input.accountId, userId); // serializes starts per account
      if (!account) throw new PaperError('NOT_FOUND', 'Paper account not found.');
      if (account.status !== 'ACTIVE') throw new PaperError('ACCOUNT_NOT_ACTIVE', `The account is ${account.status.toLowerCase()}.`);
      const [[mine], [all]] = await Promise.all([
        tx.select({ n: count() }).from(paperStrategyInstances).where(and(eq(paperStrategyInstances.userId, userId), inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING', 'PAUSED']))),
        tx.select({ n: count() }).from(paperStrategyInstances).where(inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING', 'PAUSED'])),
      ]);
      if ((mine?.n ?? 0) >= STRATEGY_LIMITS.maxLivePerUser) throw new PaperError('LIMIT_EXCEEDED', `At most ${STRATEGY_LIMITS.maxLivePerUser} live strategies per user.`);
      if ((all?.n ?? 0) >= STRATEGY_LIMITS.maxLiveTotal) throw new PaperError('LIMIT_EXCEEDED', 'The platform is at its live-strategy capacity; try later.');
      const [existing] = await tx.select({ id: paperStrategyInstances.id }).from(paperStrategyInstances)
        .where(and(eq(paperStrategyInstances.paperAccountId, account.id), eq(paperStrategyInstances.symbolId, rules.id), inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING', 'PAUSED'])));
      if (existing) throw new PaperError('STRATEGY_CONFLICT', `A strategy is already live on ${rules.symbol} in this account.`, { instanceId: existing.id });
      const [created] = await tx.insert(paperStrategyInstances).values({
        userId, paperAccountId: account.id, strategyId: stored.strategyId, strategyVersionId: stored.versionId, symbolId: rules.id, timeframe, status: 'CREATED', configuration,
      }).returning();
      await this.deps.queue.enqueue({ type: ENGINE.evaluateJobType, payload: { instanceId: created!.id }, dedupeKey: created!.id, maxAttempts: 5 }, tx);
      return created!;
    });
    this.metrics.started++;
    this.deps.log('info', 'Paper strategy created', { instanceId: row.id, userId, strategyVersionId: row.strategyVersionId, symbol: rules.symbol, timeframe });
    return instanceView({ ...row, symbol: rules.symbol });
  }

  async transition(userId: string, id: string, action: 'pause' | 'resume' | 'stop', opts: { closePosition?: boolean } = {}) {
    const now = this.deps.clock.now();
    const row = await this.deps.db.transaction(async tx => {
      const [inst] = await tx.select().from(paperStrategyInstances).where(and(eq(paperStrategyInstances.id, id), eq(paperStrategyInstances.userId, userId))).for('update');
      if (!inst) throw new PaperError('NOT_FOUND', 'Strategy instance not found.');
      const allowed: Record<typeof action, InstanceStatus[]> = { pause: ['RUNNING', 'CREATED'], resume: ['PAUSED'], stop: ['CREATED', 'RUNNING', 'PAUSED'] };
      if (!allowed[action].includes(inst.status)) throw new PaperError('INVALID_TRANSITION', `Cannot ${action} a strategy that is ${inst.status.toLowerCase()}.`, { status: inst.status });
      const changes: Partial<InstanceRow> =
        action === 'pause' ? { status: 'PAUSED', pausedAt: now }
        // Resuming continues from the latest closed candle: the paused period is not traded retroactively.
        : action === 'resume' ? { status: 'RUNNING', pausedAt: null, lastProcessedCandleTime: latestClosedOpenTime(inst.timeframe as Timeframe, now.getTime()) }
        : { status: 'STOPPED', stoppedAt: now };
      const [updated] = await tx.update(paperStrategyInstances).set(changes).where(eq(paperStrategyInstances.id, id)).returning();
      return updated!;
    });
    if (action === 'stop') this.metrics.stopped++;
    this.deps.log('info', `Paper strategy ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'stopped'}`, { instanceId: id });
    if (action === 'stop' && opts.closePosition) {
      const [position] = await this.deps.db.select().from(paperPositions).where(and(eq(paperPositions.paperAccountId, row.paperAccountId), eq(paperPositions.symbolId, row.symbolId), eq(paperPositions.status, 'OPEN')));
      if (position) await this.deps.positions.close(userId, position.id);
    }
    return this.get(userId, id);
  }

  async get(userId: string, id: string) {
    const [row] = await this.deps.db.select({ i: paperStrategyInstances, symbol: tradingSymbols.symbol }).from(paperStrategyInstances)
      .innerJoin(tradingSymbols, eq(tradingSymbols.id, paperStrategyInstances.symbolId))
      .where(and(eq(paperStrategyInstances.id, id), eq(paperStrategyInstances.userId, userId)));
    if (!row) throw new PaperError('NOT_FOUND', 'Strategy instance not found.');
    const signals = await this.deps.db.select().from(paperSignals).where(eq(paperSignals.strategyInstanceId, id)).orderBy(desc(paperSignals.candleOpenTime)).limit(20);
    return { ...instanceView({ ...row.i, symbol: row.symbol }), recentSignals: signals.map(s => ({ id: s.id, candleOpenTime: s.candleOpenTime, action: s.action, status: s.status, reason: s.reason, orderId: s.orderId, createdAt: s.createdAt })) };
  }

  async list(userId: string, f: { status?: InstanceStatus; limit: number; offset: number }) {
    const where = and(eq(paperStrategyInstances.userId, userId), f.status ? eq(paperStrategyInstances.status, f.status) : undefined);
    const [rows, [total]] = await Promise.all([
      this.deps.db.select({ i: paperStrategyInstances, symbol: tradingSymbols.symbol }).from(paperStrategyInstances)
        .innerJoin(tradingSymbols, eq(tradingSymbols.id, paperStrategyInstances.symbolId)).where(where)
        .orderBy(desc(paperStrategyInstances.createdAt)).limit(f.limit).offset(f.offset),
      this.deps.db.select({ n: count() }).from(paperStrategyInstances).where(where),
    ]);
    return { strategies: rows.map(r => instanceView({ ...r.i, symbol: r.symbol })), total: total?.n ?? 0, limit: f.limit, offset: f.offset };
  }

  /** Enqueues an evaluation (collapses into one already queued for the instance). */
  schedule(instanceId: string) {
    return this.deps.queue.enqueue({ type: ENGINE.evaluateJobType, payload: { instanceId }, dedupeKey: instanceId, maxAttempts: 5 });
  }

  // ---- Evaluation job --------------------------------------------------------------------------

  readonly jobHandler = {
    type: ENGINE.evaluateJobType,
    handle: (job: JobRecord, ctx: { isLastAttempt: boolean }) => this.evaluateJob(job, ctx),
    onFailed: async (job: JobRecord, error: string) => {
      const id = (job.payload as { instanceId?: string }).instanceId;
      if (id) this.deps.log('error', 'Paper strategy evaluation failed', { instanceId: id, error });
    },
  };

  private async evaluateJob(job: JobRecord, ctx: { isLastAttempt: boolean }): Promise<'COMPLETED'> {
    const instanceId = z.object({ instanceId: z.uuid() }).parse(job.payload).instanceId;
    try {
      await this.evaluate(instanceId);
    } catch (error) {
      if (error instanceof EvaluationDataError && error.retryable && !ctx.isLastAttempt) throw new RetryableJobError(error.message);
      if (error instanceof EngineError && error.retryable && !ctx.isLastAttempt) throw new RetryableJobError(error.message);
      if (error instanceof EngineError && !error.retryable) await this.fail(instanceId, `${error.code}: ${error.message}`);
      else if (!(error instanceof EvaluationDataError)) throw error;
      // Data still unavailable after retries: the next candle close or sweep tries again.
    }
    return 'COMPLETED';
  }

  async evaluate(instanceId: string): Promise<{ processed: number; signal: string | null }> {
    const [inst] = await this.deps.db.select().from(paperStrategyInstances).where(eq(paperStrategyInstances.id, instanceId));
    if (!inst || (inst.status !== 'CREATED' && inst.status !== 'RUNNING')) return { processed: 0, signal: null };
    const config = configurationSchema.parse(inst.configuration);
    const tf = inst.timeframe as Timeframe;
    const now = this.deps.clock.now().getTime();
    const latest = latestClosedOpenTime(tf, now);

    // First evaluation: start from the next candle; history is never traded.
    if (inst.status === 'CREATED') {
      await this.deps.db.update(paperStrategyInstances).set({ status: 'RUNNING', startedAt: new Date(now), lastProcessedCandleTime: latest })
        .where(and(eq(paperStrategyInstances.id, instanceId), eq(paperStrategyInstances.status, 'CREATED')));
      this.deps.log('info', 'Paper strategy started', { instanceId, firstCandleAfter: latest });
      return { processed: 0, signal: null };
    }

    // Finish any signal a crash left behind before evaluating new candles.
    const [leftover] = await this.deps.db.select().from(paperSignals).where(and(eq(paperSignals.strategyInstanceId, instanceId), eq(paperSignals.status, 'GENERATED')));
    if (leftover) await this.deps.signals.process(leftover, inst, config);

    const last = inst.lastProcessedCandleTime ?? candlesBefore(tf, latest, 1);
    if (last >= latest) return { processed: 0, signal: null };
    const pending: number[] = [];
    for (let t = nextOpenTime(tf, last); t <= latest && pending.length < 1000; t = nextOpenTime(tf, t)) pending.push(t);

    const rules = (await this.deps.repo.symbolRulesById(inst.symbolId))!;
    const windowStart = candlesBefore(tf, latest, config.windowCandles - 1);
    const { series } = await this.deps.evaluator.evaluate({
      scriptSha: config.script.sha256, source: config.script.source, symbol: rules, timeframe: tf, latestOpenTime: latest,
      windowStart, windowEnd: nextOpenTime(tf, latest), requiredCandles: config.requiredCandles, bars: pending.length,
    });

    const [position] = await this.deps.db.select().from(paperPositions)
      .where(and(eq(paperPositions.paperAccountId, inst.paperAccountId), eq(paperPositions.symbolId, inst.symbolId), eq(paperPositions.status, 'OPEN')));
    const byTime = new Map(series.bars.map(b => [b.openTime, b]));
    const rows: (typeof paperSignals.$inferInsert)[] = [];
    for (const t of pending) {
      const bar = byTime.get(t);
      if (!bar) continue;
      const action = !position && bar.entry ? 'ENTER_LONG' : position?.side === 'LONG' && bar.exit ? 'EXIT_LONG' : null;
      if (!action) continue;
      const newest = t === latest;
      rows.push({
        strategyInstanceId: instanceId, candleOpenTime: t, action, status: newest ? 'GENERATED' : 'SKIPPED',
        reason: newest ? null : 'Missed while catching up; only the latest closed candle is traded',
        evaluation: { entry: bar.entry, exit: bar.exit, engine: series.engine, evaluatedAt: new Date(now).toISOString(), windowStart },
      });
    }

    // Commit progress with a fence: only if nobody processed or paused the instance meanwhile.
    const generated = await this.deps.db.transaction(async (tx: Tx) => {
      const [locked] = await tx.select().from(paperStrategyInstances).where(eq(paperStrategyInstances.id, instanceId)).for('update');
      if (!locked || locked.status !== 'RUNNING' || locked.lastProcessedCandleTime !== inst.lastProcessedCandleTime) return null;
      const inserted = rows.length ? await tx.insert(paperSignals).values(rows).onConflictDoNothing().returning() : [];
      const signal = inserted.find(r => r.status === 'GENERATED') ?? null;
      await tx.update(paperStrategyInstances).set({ lastProcessedCandleTime: latest, ...(signal && { lastSignalId: signal.id }) }).where(eq(paperStrategyInstances.id, instanceId));
      return { signal };
    });
    if (!generated) return { processed: 0, signal: null };
    if (generated.signal) {
      this.deps.log('info', 'Strategy signal generated', { instanceId, signalId: generated.signal.id, action: generated.signal.action, candleOpenTime: latest });
      await this.deps.signals.process(generated.signal, { ...inst, lastProcessedCandleTime: latest }, config);
    }
    return { processed: pending.length, signal: generated.signal?.id ?? null };
  }

  private async fail(instanceId: string, message: string) {
    await this.deps.db.update(paperStrategyInstances).set({ status: 'FAILED', errorMessage: message.slice(0, 2000), stoppedAt: this.deps.clock.now() })
      .where(and(eq(paperStrategyInstances.id, instanceId), inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING'])));
    this.metrics.failed++;
    this.deps.log('error', 'Paper strategy failed', { instanceId, error: message });
  }

  /** Instances that should be evaluated now: RUNNING and behind the latest closed candle, or CREATED. */
  async dueInstances() {
    const rows = await this.deps.db.select({ id: paperStrategyInstances.id, status: paperStrategyInstances.status, timeframe: paperStrategyInstances.timeframe, last: paperStrategyInstances.lastProcessedCandleTime })
      .from(paperStrategyInstances).where(inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING']));
    const now = this.deps.clock.now().getTime();
    return rows.filter(r => r.status === 'CREATED' || (r.last ?? 0) < latestClosedOpenTime(r.timeframe as Timeframe, now)).map(r => r.id);
  }
}

export { timeframeMs };
