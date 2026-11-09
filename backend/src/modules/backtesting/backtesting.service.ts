// Backtesting use cases: create/list/read/cancel backtests, quick previews of unsaved AI drafts,
// and the background-job handler that runs a backtest end to end.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Logger } from '../../logger';
import type { Timeframe } from '../market/domain/market-options';
import { normalizeExchange, normalizeSymbol } from '../market/domain/rules';
import type { StrategyService } from '../strategies';
import { strategyDefinitionSchema, type StrategyDefinition } from '../strategies/domain/definition';
import type { JobContext, JobRecord, PostgresJobQueue } from '../system/jobs';
import { RetryableJobError } from '../system/jobs';
import { BACKTEST_JOB_TYPE, DEFAULTS, LIMITS, QUEUE, SANDBOX_LIMITS } from './backtesting.constants';
import type { CandleHistory } from './backtesting.market-history';
import type { BacktestStatus, BacktestingRepository, JobRow } from './backtesting.repository';
import type { CreateBacktestRequest, PreviewBacktestRequest } from './backtesting.schemas';
import { positionSizingSchema } from './backtesting.schemas';
import type {
  BacktestMetrics, BacktestSettings, BacktestWarning, DatasetCandle, DatasetInfo, EngineInput, EngineResult, SymbolSpec,
} from './backtesting.types';
import { EngineError, type BacktestEngine } from './engines/backtest-engine.interface';
import { definitionToPine } from './engines/resin/definition-to-pine';
import { dec } from './utils/decimal';
import { computeMetrics, downsampleEquity } from './utils/metrics';
import { alignDown, candlesBefore, DatasetError, definitionWarnings, expectedCandleCount, requiredCandles, validateDataset } from './utils/validation';

export type BacktestErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'STRATEGY_NOT_FOUND' | 'UNKNOWN_SYMBOL' | 'INVALID_STRATEGY' | 'RANGE_TOO_LARGE'
  | 'INSUFFICIENT_DATA' | 'DATA_GAPS' | 'TOO_MANY_ACTIVE' | 'NOT_CANCELLABLE' | 'BUSY' | 'ENGINE_ERROR' | 'MARKET_DATA_UNAVAILABLE';

export class BacktestError extends Error {
  constructor(readonly code: BacktestErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BacktestError';
  }
}

/** Everything needed to reproduce a run, stored in backtest_jobs.configuration. */
const configurationSchema = z.object({
  schemaVersion: z.literal(1),
  queueJobId: z.uuid(),
  strategy: z.object({ strategyId: z.uuid(), versionId: z.uuid(), version: z.number(), name: z.string(), engineVersion: z.string() }),
  script: z.object({ language: z.literal('pine'), version: z.literal(6), generatedFrom: z.literal('strategy_definition_v1'), source: z.string(), sha256: z.string() }),
  engine: z.object({ name: z.string(), version: z.string(), revision: z.string() }),
  market: z.object({ exchange: z.string(), symbol: z.string(), baseAsset: z.string(), quoteAsset: z.string(), timeframe: z.string(), tickSize: z.string(), lotSize: z.string() }),
  range: z.object({ start: z.number(), end: z.number(), expectedCandles: z.number(), requiredCandles: z.number() }),
  settings: z.object({ initialCapital: z.string(), commissionPercent: z.string(), slippageTicks: z.number(), positionSizing: positionSizingSchema }),
  assumptions: z.record(z.string(), z.string()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  dataset: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional(),
});
type Configuration = z.infer<typeof configurationSchema>;

const ASSUMPTIONS = {
  fills: 'Market orders fill at the next candle\'s open; stop/limit orders fill when price trades through them (TradingView broker emulator).',
  intrabarPath: 'Within a candle, price is assumed to move open → nearer extreme → farther extreme → close.',
  commission: 'Charged as a percentage of traded value on entry and on exit.',
  slippage: 'Moves every market and stop fill the given number of ticks against the order.',
  candles: 'Only fully closed candles stored in market_candles are used; times are UTC.',
  quantities: 'Default order sizes are floored to whole lots of the symbol\'s lot size; prices are on its tick grid.',
};

type Deps = {
  repo: BacktestingRepository;
  queue: PostgresJobQueue;
  engine: BacktestEngine;
  history: CandleHistory;
  strategies: StrategyService;
  clock: { now(): Date };
  log: Logger;
};

export class BacktestingService {
  private readonly previewing = new Set<string>();

  constructor(private readonly deps: Deps) {}

  // ---- Create ----------------------------------------------------------------------------------

  async create(userId: string, request: CreateBacktestRequest) {
    const { repo } = this.deps;
    if ((await repo.countActive(userId)) >= LIMITS.maxActiveBacktestsPerUser) {
      throw new BacktestError('TOO_MANY_ACTIVE', `You can have at most ${LIMITS.maxActiveBacktestsPerUser} backtests queued or running.`);
    }
    const stored = await repo.findStrategyVersion(userId, request.strategyId, request.strategyVersionId);
    if (!stored) throw new BacktestError('STRATEGY_NOT_FOUND', 'Strategy or strategy version not found.');
    const parsed = strategyDefinitionSchema.safeParse(stored.definition);
    if (!parsed.success) throw new BacktestError('INVALID_STRATEGY', 'This strategy version cannot be backtested: its definition is invalid.');
    const definition = parsed.data;

    const timeframe = request.market?.timeframe ?? definition.market.timeframe;
    const symbol = await this.resolveSymbol(request.market?.exchange ?? definition.market.exchange, request.market?.symbol ?? definition.market.symbol);
    const range = this.resolveRange(timeframe, request.range?.start, request.range?.end, DEFAULTS.lookbackCandles, LIMITS.maxCandles, requiredCandles(definition));
    const settings = resolveSettings(request.settings, definition);
    const source = definitionToPine(stored.name, { ...definition, market: { ...definition.market, exchange: symbol.exchange, symbol: symbol.symbol, timeframe } });

    const id = crypto.randomUUID(), queueJobId = crypto.randomUUID();
    const configuration: Configuration = {
      schemaVersion: 1,
      queueJobId,
      strategy: { strategyId: stored.strategyId, versionId: stored.versionId, version: stored.version, name: stored.name, engineVersion: stored.engineVersion },
      script: { language: 'pine', version: 6, generatedFrom: 'strategy_definition_v1', source, sha256: sha256(source) },
      engine: { ...this.deps.engine.identity },
      market: { exchange: symbol.exchange, symbol: symbol.symbol, baseAsset: symbol.baseAsset, quoteAsset: symbol.quoteAsset, timeframe, tickSize: symbol.tickSize, lotSize: symbol.lotSize },
      range,
      settings,
      assumptions: ASSUMPTIONS,
      warnings: definitionWarnings(definition),
    };
    const row = await repo.create(
      {
        id, userId, strategyVersionId: stored.versionId, symbolId: symbol.id, timeframe,
        startTime: range.start, endTime: range.end,
        initialBalance: settings.initialCapital,
        feeRate: dec.div(settings.commissionPercent, '100'),
        // Slippage is tick-based (configuration.settings.slippageTicks); there is no percentage rate.
        slippageRate: '0',
        configuration,
      },
      tx => this.deps.queue.enqueue({ id: queueJobId, type: BACKTEST_JOB_TYPE, payload: { backtestJobId: id }, maxAttempts: QUEUE.maxAttempts }, tx),
    );
    this.deps.log('info', 'Backtest queued', { backtestId: id, userId, strategyVersionId: stored.versionId, symbol: symbol.symbol, timeframe, candles: range.expectedCandles });
    return this.view(row, null);
  }

  // ---- Reads -----------------------------------------------------------------------------------

  async list(userId: string, opts: { limit: number; before?: Date; status?: BacktestStatus; strategyId?: string }) {
    const rows = await this.deps.repo.list(userId, opts);
    return {
      backtests: rows.map(r => this.view(r.job, r.result ? (r.result.metrics as unknown as BacktestMetrics) : null, { compact: true })),
      nextBefore: rows.length === opts.limit ? rows.at(-1)!.job.createdAt.toISOString() : null,
    };
  }

  async get(userId: string, id: string) {
    const row = await this.deps.repo.getForUser(userId, id);
    if (!row) throw new BacktestError('NOT_FOUND', 'Backtest not found.');
    const result = await this.deps.repo.result(id);
    return this.view(row, result ? (result.metrics as unknown as BacktestMetrics) : null);
  }

  async trades(userId: string, id: string, limit: number, offset: number) {
    const row = await this.deps.repo.getForUser(userId, id);
    if (!row) throw new BacktestError('NOT_FOUND', 'Backtest not found.');
    const { total, trades } = await this.deps.repo.trades(id, limit, offset);
    return { backtestId: id, status: row.status, total, limit, offset, trades };
  }

  async equityCurve(userId: string, id: string, maxPoints: number) {
    const row = await this.deps.repo.getForUser(userId, id);
    if (!row) throw new BacktestError('NOT_FOUND', 'Backtest not found.');
    const result = await this.deps.repo.result(id);
    const stored = (result?.metrics as { equityCurve?: { time: number; equity: string }[] } | undefined)?.equityCurve ?? [];
    const points = downsampleEquity(stored.map(p => p.time), stored.map(p => p.equity), maxPoints);
    return { backtestId: id, status: row.status, initialCapital: dec.from(row.initialBalance), points };
  }

  // ---- Cancel ----------------------------------------------------------------------------------

  async cancel(userId: string, id: string) {
    const row = await this.deps.repo.cancel(userId, id, async (tx, job) => {
      const config = configurationSchema.safeParse(job.configuration);
      if (config.success) await this.deps.queue.cancelPending(config.data.queueJobId, tx);
    });
    if (!row) {
      const existing = await this.deps.repo.getForUser(userId, id);
      if (!existing) throw new BacktestError('NOT_FOUND', 'Backtest not found.');
      throw new BacktestError('NOT_CANCELLABLE', `This backtest is already ${existing.status.toLowerCase()}.`, { status: existing.status });
    }
    this.deps.log('info', 'Backtest cancelled', { backtestId: id, userId });
    return this.view(row, null);
  }

  // ---- Preview (quick backtest of an unsaved AI draft) ------------------------------------------

  /**
   * Runs a short backtest of a strategy definition that is not saved yet (e.g. an AI draft) and
   * returns the summary with warnings. Nothing is stored. The request waits for the sandboxed run
   * (bounded candles and a short timeout); the API process itself never executes the script.
   */
  async preview(userId: string, request: PreviewBacktestRequest) {
    const validated = await this.deps.strategies.validate({ name: request.name ?? 'Strategy preview', definition: request.definition });
    if (!validated.ok) throw new BacktestError('VALIDATION_ERROR', 'The strategy definition is invalid.', { fields: validated.errors });
    const { name, definition } = validated.draft;
    if (this.previewing.has(userId)) throw new BacktestError('BUSY', 'A quick backtest is already running for you.');
    this.previewing.add(userId);
    try {
      const symbol = await this.resolveSymbol(definition.market.exchange, definition.market.symbol);
      const timeframe = definition.market.timeframe;
      const required = requiredCandles(definition);
      const range = this.resolveRange(timeframe, undefined, undefined, Math.max(request.candles ?? DEFAULTS.previewCandles, required), LIMITS.maxPreviewCandles, required);
      const settings = resolveSettings(request.settings, definition);
      const { candles, dataset } = await this.loadDataset(symbol, timeframe, range, required);
      const script = { language: 'pine' as const, version: 6 as const, generatedFrom: 'strategy_definition_v1' as const, source: definitionToPine(name, definition) };
      const result = await this.runEngine({ script, candles, timeframe, symbol, settings }, SANDBOX_LIMITS.previewWallTimeoutMs);
      const metrics = computeMetrics(result, candles, settings.initialCapital);
      return {
        engine: result.engine,
        market: { exchange: symbol.exchange, symbol: symbol.symbol, timeframe },
        range: { start: dataset.firstOpenTime, end: dataset.lastCloseTime + 1 },
        settings,
        dataset,
        metrics,
        warnings: [...definitionWarnings(definition), ...resultWarnings(metrics, result, dataset)],
        trades: result.trades.slice(-50),
        equityCurve: downsampleEquity(candles.map(c => c.openTime), result.equity, 200),
        saved: false,
      };
    } finally {
      this.previewing.delete(userId);
    }
  }

  // ---- Background job --------------------------------------------------------------------------

  readonly jobHandler = {
    type: BACKTEST_JOB_TYPE,
    handle: (job: JobRecord, ctx: JobContext) => this.process(job, ctx),
    onFailed: async (job: JobRecord, error: string) => {
      const id = payloadSchema.safeParse(job.payload);
      if (id.success && (await this.deps.repo.markFailed(id.data.backtestJobId, error))) {
        this.deps.log('error', 'Backtest failed', { backtestId: id.data.backtestJobId, error });
      }
    },
  };

  private async process(job: JobRecord, ctx: JobContext): Promise<'COMPLETED' | 'CANCELLED'> {
    const { repo, log } = this.deps;
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) throw new Error('Invalid backtest job payload');
    const id = payload.data.backtestJobId;

    const existing = await repo.get(id);
    // Idempotency: a finished, failed or cancelled backtest is never run again.
    if (!existing || existing.status === 'COMPLETED' || existing.status === 'FAILED') return 'COMPLETED';
    if (existing.status === 'CANCELLED') return 'CANCELLED';
    const row = await repo.markRunning(id, this.deps.clock.now());
    if (!row) return (await repo.status(id)) === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';

    const config = configurationSchema.parse(row.configuration);
    const fail = async (code: string, message: string, details?: unknown) => {
      await repo.markFailed(id, message, { ...config, error: { code, message, details } });
      log('warn', 'Backtest failed', { backtestId: id, code, message });
      return 'COMPLETED' as const; // the job is done; the backtest records the failure
    };
    const timeframe = config.market.timeframe as Timeframe;
    const symbol: SymbolSpec & { id: string } = { id: row.symbolId, ...config.market };

    // 1. Candles (trusted process): backfill into Postgres if needed, then read and validate.
    let loaded: { candles: DatasetCandle[]; dataset: DatasetInfo };
    try {
      loaded = await this.loadDataset(symbol, timeframe, config.range, config.range.requiredCandles);
    } catch (error) {
      if (error instanceof DatasetError) return fail(error.code, error.message, error.details);
      if (error instanceof BacktestError && error.code === 'MARKET_DATA_UNAVAILABLE' && !ctx.isLastAttempt) throw new RetryableJobError(error.message);
      if (error instanceof BacktestError) return fail(error.code, error.message);
      throw error;
    }

    // 2. Run the engine in the sandbox, watching for cancellation.
    const controller = new AbortController();
    const watcher = setInterval(() => {
      repo.status(id).then(s => s === 'CANCELLED' && controller.abort(), () => {});
    }, QUEUE.cancelPollMs);
    let result: EngineResult;
    try {
      result = await this.deps.engine.run(
        { script: { language: 'pine', version: 6, generatedFrom: 'strategy_definition_v1', source: config.script.source }, candles: loaded.candles, timeframe, symbol, settings: config.settings },
        { signal: controller.signal, timeoutMs: SANDBOX_LIMITS.wallTimeoutMs },
      );
    } catch (error) {
      if (error instanceof EngineError) {
        if (error.code === 'CANCELLED') return 'CANCELLED';
        if (error.retryable && !ctx.isLastAttempt) throw new RetryableJobError(error.message);
        return fail(error.code, error.message, error.details);
      }
      throw error;
    } finally {
      clearInterval(watcher);
    }

    // 3. Metrics (exact decimals) and persistence.
    const metrics = computeMetrics(result, loaded.candles, config.settings.initialCapital);
    const warnings = [...config.warnings, ...resultWarnings(metrics, result, loaded.dataset)];
    const saved = await repo.saveResult(row, { ...config, dataset: loaded.dataset, warnings }, row.symbolId, {
      metrics,
      trades: result.trades,
      equityCurve: downsampleEquity(loaded.candles.map(c => c.openTime), result.equity, LIMITS.equityCurvePoints),
      warnings,
      dataset: loaded.dataset,
      engineDurationMs: result.durationMs,
    });
    if (!saved) return (await repo.status(id)) === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
    log('info', 'Backtest completed', { backtestId: id, trades: metrics.totalTrades, netProfit: metrics.netProfit, engineMs: Math.round(result.durationMs) });
    return 'COMPLETED';
  }

  // ---- Shared steps ----------------------------------------------------------------------------

  private async resolveSymbol(rawExchange: string, rawSymbol: string) {
    const exchange = normalizeExchange(rawExchange), symbol = normalizeSymbol(rawSymbol);
    const found = exchange && symbol ? await this.deps.repo.findInstrument(exchange, symbol) : null;
    if (!found) throw new BacktestError('UNKNOWN_SYMBOL', `${rawSymbol} is not an active market on ${rawExchange}.`);
    return found;
  }

  /** [start, end) in UTC ms. End defaults to now and never passes it; only closed candles count. */
  private resolveRange(tf: Timeframe, start: number | undefined, end: number | undefined, defaultCandles: number, maxCandles: number, minCandles: number) {
    const now = this.deps.clock.now().getTime();
    const rangeEnd = Math.min(end ?? now, now);
    // Default: the last N fully closed candles (the candle containing `rangeEnd` is not closed yet,
    // unless rangeEnd falls exactly on a boundary).
    const rangeStart = start ?? candlesBefore(tf, alignDown(tf, rangeEnd), defaultCandles);
    if (rangeEnd <= rangeStart) throw new BacktestError('VALIDATION_ERROR', 'The range end must be after its start.', { fields: { range: 'end must be after start' } });
    const expectedCandles = expectedCandleCount(tf, rangeStart, rangeEnd);
    if (expectedCandles > maxCandles) {
      throw new BacktestError('RANGE_TOO_LARGE', `The range covers ${expectedCandles} ${tf} candles; the maximum is ${maxCandles}.`, { expectedCandles, maxCandles });
    }
    if (expectedCandles < minCandles) {
      throw new BacktestError('INSUFFICIENT_DATA', `The range covers ${expectedCandles} ${tf} candles; this strategy needs at least ${minCandles}.`, { expectedCandles, required: minCandles });
    }
    return { start: rangeStart, end: rangeEnd, expectedCandles, requiredCandles: minCandles };
  }

  private async loadDataset(symbol: SymbolSpec & { id: string }, tf: Timeframe, range: { start: number; end: number; expectedCandles: number }, minCandles: number) {
    const { repo, history } = this.deps;
    try {
      const stored = await repo.countCandles(symbol.id, tf, range.start, range.end);
      await history.ensure({ exchange: symbol.exchange, symbol: symbol.symbol, timeframe: tf, start: range.start, end: range.end, expected: range.expectedCandles, stored });
    } catch (error) {
      if (error instanceof Error && error.name === 'MarketError') throw new BacktestError('MARKET_DATA_UNAVAILABLE', 'Historical candles could not be fetched right now.');
      throw error;
    }
    const raw = await repo.loadCandles(symbol.id, tf, range.start, range.end);
    const report = validateDataset(raw, tf, { start: range.start, end: range.end, now: this.deps.clock.now().getTime() }, minCandles);
    const candles = report.candles.map(({ openTime, closeTime, open, high, low, close, volume }) => ({ openTime, closeTime, open, high, low, close, volume }));
    const dataset: DatasetInfo = {
      candles: candles.length,
      expectedCandles: report.expected,
      missingCandles: report.missing,
      firstOpenTime: candles[0]!.openTime,
      lastCloseTime: candles.at(-1)!.closeTime,
      checksum: sha256(candles.map(c => `${c.openTime},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n')),
      source: 'market_candles',
    };
    return { candles, dataset };
  }

  private async runEngine(input: EngineInput, timeoutMs: number) {
    try {
      return await this.deps.engine.run(input, { timeoutMs });
    } catch (error) {
      if (error instanceof EngineError) {
        if (error.code === 'BUSY') throw new BacktestError('BUSY', error.message);
        throw new BacktestError('ENGINE_ERROR', error.message, { engineCode: error.code, details: error.details });
      }
      throw error;
    }
  }

  private view(row: JobRow, metrics: BacktestMetrics | null, opts: { compact?: boolean } = {}) {
    const config = configurationSchema.safeParse(row.configuration);
    const c = config.success ? config.data : null;
    const stored = metrics as (BacktestMetrics & { warnings?: BacktestWarning[]; dataset?: DatasetInfo; equityCurve?: unknown }) | null;
    const { warnings: resultWarningsList, dataset, equityCurve: _curve, ...summary } = stored ?? ({} as Record<string, never>);
    return {
      id: row.id,
      status: row.status,
      strategy: c ? { id: c.strategy.strategyId, versionId: c.strategy.versionId, version: c.strategy.version, name: c.strategy.name } : { versionId: row.strategyVersionId },
      market: c ? { exchange: c.market.exchange, symbol: c.market.symbol, timeframe: c.market.timeframe } : { timeframe: row.timeframe },
      range: { start: row.startTime, end: row.endTime },
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      error: row.status === 'FAILED' ? { message: row.errorMessage, code: c?.error?.code ?? null } : null,
      summary: stored ? summary : null,
      ...(!opts.compact && {
        settings: c?.settings,
        engine: c?.engine,
        symbol: c ? { tickSize: c.market.tickSize, lotSize: c.market.lotSize, baseAsset: c.market.baseAsset, quoteAsset: c.market.quoteAsset } : undefined,
        assumptions: c?.assumptions,
        warnings: resultWarningsList ?? c?.warnings ?? [],
        dataset: dataset ?? null,
        script: c ? { language: c.script.language, version: c.script.version, sha256: c.script.sha256, source: c.script.source } : undefined,
      }),
    };
  }
}

const payloadSchema = z.object({ backtestJobId: z.uuid() });
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function resolveSettings(input: CreateBacktestRequest['settings'], def: StrategyDefinition): BacktestSettings {
  return {
    initialCapital: dec.from(input?.initialCapital ?? DEFAULTS.initialCapital),
    commissionPercent: dec.from(input?.commissionPercent ?? DEFAULTS.commissionPercent),
    slippageTicks: input?.slippageTicks ?? DEFAULTS.slippageTicks,
    positionSizing: input?.positionSizing
      ? { ...input.positionSizing, value: dec.from(input.positionSizing.value) }
      : { type: 'percent_of_equity', value: dec.from(String(def.risk.positionSizePercent ?? DEFAULTS.positionSizePercent)) },
  };
}

/** Warnings that need the result. Zero trades is reported, never treated as an error. */
function resultWarnings(m: BacktestMetrics, result: EngineResult, dataset: DatasetInfo): BacktestWarning[] {
  const w: BacktestWarning[] = [];
  if (m.totalTrades === 0 && !result.openPosition) {
    w.push({ code: 'ZERO_TRADES', message: 'The strategy did not trade in this period. Its conditions may never be true together, or it trades rarely; try a longer range.' });
  } else if (m.totalTrades < 10) {
    w.push({ code: 'FEW_TRADES', message: `Only ${m.totalTrades} closed trades: too few for reliable statistics.` });
  }
  if (result.openPosition) w.push({ code: 'OPEN_POSITION', message: 'A position was still open at the end; its value is included as unrealized P/L.' });
  if (dataset.missingCandles > 0) w.push({ code: 'DATA_GAPS', message: `${dataset.missingCandles} of ${dataset.expectedCandles} candles are missing from the range.` });
  return w;
}
