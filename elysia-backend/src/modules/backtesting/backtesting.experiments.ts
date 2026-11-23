import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { z } from 'zod';
import { backtestDatasets, backtestExperiments, users } from '../../db/schema';
import type { AppDatabase } from '../../db/types';
import { parseJson, validationError } from '../../http/validation';
import type { UserGuard } from '../identity';
import { TIMEFRAMES } from '../market/domain/market-options';
import { strategyDefinitionSchema, type StrategyDefinition } from '../strategies/domain/definition';
import type { JobContext, JobRecord, PostgresJobQueue } from '../system/jobs';
import { RetryableJobError } from '../system/jobs';
import { DEFAULTS, LIMITS, SANDBOX_LIMITS } from './backtesting.constants';
import { settingsSchema, riskStatisticsSchema } from './backtesting.schemas';
import { BacktestError, snapshotChecksum } from './backtesting.service';
import type { BacktestSettings, DatasetCandle } from './backtesting.types';
import { parseMarketDataset, selectDatasetCandles, type MarketDataset } from './datasets/import';
import { EngineError, type BacktestEngine } from './engines/backtest-engine.interface';
import { definitionToPine } from './engines/resin/definition-to-pine';
import { calendarWarmupStart, expectedSessionCandles } from './market-models/calendar';
import { optionsExperimentSchema } from './market-models/options';
import { PortfolioSandbox } from './portfolio-sandbox';
import { evaluateWalkForward, compareParameterVariants } from './research/walk-forward';
import { computeMetrics, downsampleEquity } from './utils/metrics';
import { computeRiskStatistics } from './research/risk-statistics';
import { alignDown, candlesBefore, maxLookback, validateDataset } from './utils/validation';

const JOB_TYPE = 'backtesting.experiment';
const epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const researchObjectiveSchema = z.enum(['total_return', 'min_drawdown', 'sharpe', 'sortino']);
export type ResearchObjective = z.infer<typeof researchObjectiveSchema>;
export const experimentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['single', 'walk_forward']), datasetId: z.uuid(), instrumentId: z.string().min(1).max(128),
    timeframe: z.enum(TIMEFRAMES), range: z.strictObject({ start: epoch, end: epoch }),
    definitions: z.array(strategyDefinitionSchema).min(1).max(8), settings: settingsSchema.optional(),
    riskStatistics: riskStatisticsSchema.optional(),
    objective: researchObjectiveSchema.default('total_return').describe('Walk-forward training objective. min_drawdown minimizes candle-close maxDrawdownPercent. Ratio objectives require explicit riskStatistics.'),
    walkForward: z.strictObject({
      trainBars: z.number().int().min(100).max(30_000), testBars: z.number().int().min(20).max(10_000),
      embargoBars: z.number().int().min(1).max(1000).default(1), stepBars: z.number().int().min(20).max(30_000).optional(), anchored: z.boolean().default(false),
    }).optional(),
  }),
  z.strictObject({ kind: z.literal('options'), datasetId: z.uuid(), execution: optionsExperimentSchema }),
]);
type Experiment = z.infer<typeof experimentSchema>;

/** Convert an explicitly chosen metric into a higher-is-better selection utility. */
export function researchRanking(objective: ResearchObjective, metrics: Record<string, unknown>) {
  const metric = objective === 'total_return' ? 'totalReturnPercent' : objective === 'min_drawdown' ? 'maxDrawdownPercent' : objective;
  const ratios = metrics.riskStatistics as Record<string, unknown> | undefined;
  const raw = objective === 'sharpe' || objective === 'sortino' ? ratios?.[objective] : metrics[metric];
  if (raw === undefined || raw === null) throw new EngineError('INVALID_INPUT', `The ${objective} objective is undefined for this candidate/window: ${typeof ratios?.reason === 'string' ? ratios.reason : 'insufficient observations or return variation'}. Choose another objective or a suitable evaluation window.`);
  const objectiveValue = Number(raw);
  if (!Number.isFinite(objectiveValue)) throw new EngineError('INVALID_INPUT', `The ${objective} objective is non-finite for this candidate/window.`);
  return { metric, objectiveValue, rankingScore: objective === 'min_drawdown' ? -objectiveValue : objectiveValue };
}

function selectionDescription(objective: ResearchObjective) {
  const descriptions = {
    total_return: 'Maximize training totalReturnPercent; rankingScore equals the percentage return.',
    min_drawdown: 'Minimize training candle-close maxDrawdownPercent; rankingScore is its negative, while objectiveValue and metrics retain the actual non-negative drawdown.',
    sharpe: 'Maximize the training Sharpe ratio using the supplied annual sampling convention and risk-free rate.',
    sortino: 'Maximize the training Sortino ratio using the supplied annual sampling convention and risk-free rate.',
  };
  return `${descriptions[objective]} Freeze the selected candidate before evaluating its held-out window. Higher rankingScore is preferred.`;
}

/** Research runs use immutable user-owned imports, never the mutable live-market cache. */
export class BacktestExperiments {
  constructor(private deps: { db: AppDatabase; queue: PostgresJobQueue; engine: BacktestEngine; portfolio: PortfolioSandbox; now: () => Date }) {}

  async import(userId: string, value: unknown) {
    const { dataset, checksum } = parseMarketDataset(value);
    return this.deps.db.transaction(async tx => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const existing = await tx.select({ id: backtestDatasets.id }).from(backtestDatasets).where(eq(backtestDatasets.userId, userId)).limit(20);
      if (existing.length >= 20) throw new BacktestError('TOO_MANY_ACTIVE', 'At most 20 historical datasets can be retained per account.');
      const ranges = new Map<string, { instrumentId: string; timeframe: string; start: number; end: number; candles: number }>();
      for (const c of dataset.candles) {
        const key = `${c.instrumentId}:${c.timeframe}`, prior = ranges.get(key);
        if (prior) { prior.start = Math.min(prior.start, c.openTime); prior.end = Math.max(prior.end, c.closeTime + 1); prior.candles++; }
        else ranges.set(key, { instrumentId: c.instrumentId, timeframe: c.timeframe, start: c.openTime, end: c.closeTime + 1, candles: 1 });
      }
      const summary = { instruments: dataset.instruments.map(({ id, symbol, exchange, assetClass }) => ({ id, symbol, exchange, assetClass })), candleCount: dataset.candles.length, quoteCount: dataset.quotes.length, ranges: [...ranges.values()] };
      const [row] = await tx.insert(backtestDatasets).values({ userId, name: dataset.name, checksum, summary, payload: dataset }).returning();
      return this.datasetView(row!);
    });
  }
  private datasetView(row: Pick<typeof backtestDatasets.$inferSelect, 'id' | 'name' | 'checksum' | 'createdAt' | 'summary'>) {
    return { id: row.id, name: row.name, checksum: row.checksum, createdAt: row.createdAt, ...row.summary };
  }
  async datasets(userId: string) {
    const rows = await this.deps.db.select({ id: backtestDatasets.id, name: backtestDatasets.name, checksum: backtestDatasets.checksum, createdAt: backtestDatasets.createdAt, summary: backtestDatasets.summary }).from(backtestDatasets).where(eq(backtestDatasets.userId, userId)).orderBy(desc(backtestDatasets.createdAt)).limit(100);
    return { datasets: rows.map(row => this.datasetView(row)) };
  }
  async dataset(userId: string, id: string) {
    const [row] = await this.deps.db.select().from(backtestDatasets).where(and(eq(backtestDatasets.id, id), eq(backtestDatasets.userId, userId)));
    if (!row) throw new BacktestError('NOT_FOUND', 'Dataset not found.');
    return { ...this.datasetView(row), dataset: row.payload as unknown as MarketDataset };
  }
  async create(userId: string, input: Experiment) {
    const dataset = await this.dataset(userId, input.datasetId);
    if (input.kind === 'options' && input.execution.end > this.deps.now().getTime()) throw new BacktestError('VALIDATION_ERROR', 'Choose a closed historical portfolio range.');
    if (input.kind !== 'options') {
      if (input.kind !== 'walk_forward' && input.objective !== 'total_return') throw new BacktestError('VALIDATION_ERROR', 'A selection objective is only supported for walk-forward research.');
      if ((input.objective === 'sharpe' || input.objective === 'sortino') && !input.riskStatistics) throw new BacktestError('VALIDATION_ERROR', `${input.objective} selection requires explicit riskStatistics.periodsPerYear and an optional annualRiskFreeRate.`);
      if (!dataset.dataset.instruments.some(i => i.id === input.instrumentId)) throw new BacktestError('VALIDATION_ERROR', 'Instrument is absent from this dataset.');
      if (input.range.end <= input.range.start || input.range.end > this.deps.now().getTime()) throw new BacktestError('VALIDATION_ERROR', 'Choose a closed historical range.');
      if (input.kind === 'walk_forward' && !input.walkForward) throw new BacktestError('VALIDATION_ERROR', 'Walk-forward settings are required.');
      if (input.kind === 'single' && input.definitions.length !== 1) throw new BacktestError('VALIDATION_ERROR', 'A single run requires one strategy definition.');
      const candles = selectDatasetCandles(dataset.dataset, input.instrumentId, input.timeframe, input.range.start, input.range.end);
      if (candles.length < 100 || candles.length > LIMITS.maxCandles) throw new BacktestError('RANGE_TOO_LARGE', 'Select between 100 and 50,000 candles.');
      if (input.walkForward && Math.floor((candles.length - input.walkForward.trainBars - input.walkForward.embargoBars - input.walkForward.testBars) / (input.walkForward.stepBars ?? input.walkForward.testBars)) + 1 > 10) {
        throw new BacktestError('RANGE_TOO_LARGE', 'At most 10 walk-forward windows are allowed per experiment.');
      }
    }
    return this.deps.db.transaction(async tx => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const active = await tx.select({ id: backtestExperiments.id }).from(backtestExperiments).where(and(eq(backtestExperiments.userId, userId), inArray(backtestExperiments.status, ['PENDING', 'RUNNING'])));
      if (active.length >= 3) throw new BacktestError('TOO_MANY_ACTIVE', 'At most three research experiments can be active.');
      const [row] = await tx.insert(backtestExperiments).values({ userId, datasetId: input.datasetId, kind: input.kind, request: { ...input, engine: this.deps.engine.identity, datasetChecksum: dataset.checksum } }).returning();
      await this.deps.queue.enqueue({ type: JOB_TYPE, payload: { experimentId: row!.id }, maxAttempts: 3 }, tx);
      return row!;
    });
  }
  async list(userId: string) {
    const rows = await this.deps.db.select({
      id: backtestExperiments.id, userId: backtestExperiments.userId, datasetId: backtestExperiments.datasetId,
      kind: backtestExperiments.kind, status: backtestExperiments.status, request: backtestExperiments.request,
      error: backtestExperiments.error, createdAt: backtestExperiments.createdAt,
      completed: sql<boolean>`${backtestExperiments.result} IS NOT NULL`,
    }).from(backtestExperiments).where(eq(backtestExperiments.userId, userId)).orderBy(desc(backtestExperiments.createdAt)).limit(100);
    return { experiments: rows };
  }
  async get(userId: string, id: string) {
    const [row] = await this.deps.db.select().from(backtestExperiments).where(and(eq(backtestExperiments.id, id), eq(backtestExperiments.userId, userId)));
    if (!row) throw new BacktestError('NOT_FOUND', 'Experiment not found.');
    return row;
  }
  async cancel(userId: string, id: string) {
    await this.get(userId, id);
    const [row] = await this.deps.db.update(backtestExperiments).set({ status: 'CANCELLED' }).where(and(eq(backtestExperiments.id, id), inArray(backtestExperiments.status, ['PENDING', 'RUNNING']))).returning();
    if (!row) throw new BacktestError('NOT_CANCELLABLE', 'Experiment is already finished.');
    return row;
  }

  readonly jobHandler = {
    type: JOB_TYPE,
    handle: (job: JobRecord, context: JobContext) => this.process(job, context),
    onFailed: async (job: JobRecord, message: string) => {
      const id = (job.payload as { experimentId?: string }).experimentId;
      if (id) await this.deps.db.update(backtestExperiments).set({ status: 'FAILED', error: message.slice(0, 2000) }).where(and(eq(backtestExperiments.id, id), inArray(backtestExperiments.status, ['PENDING', 'RUNNING'])));
    },
  };
  private async process(job: JobRecord, context: JobContext): Promise<'COMPLETED' | 'CANCELLED'> {
    const { experimentId } = z.object({ experimentId: z.uuid() }).parse(job.payload);
    const [row] = await this.deps.db.update(backtestExperiments).set({ status: 'RUNNING', error: null }).where(and(eq(backtestExperiments.id, experimentId), inArray(backtestExperiments.status, ['PENDING', 'RUNNING']))).returning();
    if (!row) return 'COMPLETED';
    const { engine, datasetChecksum, ...raw } = row.request;
    const request = experimentSchema.parse(raw);
    const archived = await this.dataset(row.userId, row.datasetId);
    if (datasetChecksum !== archived.checksum || snapshotChecksum(engine) !== snapshotChecksum(this.deps.engine.identity)) throw new Error('Dataset or engine identity changed.');
    if (parseMarketDataset(archived.dataset).checksum !== archived.checksum) throw new Error('Dataset checksum mismatch.');
    const controller = new AbortController();
    let timedOut = false;
    // Stay below the queue's five-minute lease even when a research run has many folds.
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 240_000);
    const watcher = setInterval(() => { this.get(row.userId, row.id).then(r => { if (r.status === 'CANCELLED') controller.abort(); }, () => {}); }, 500);
    try {
      const result: Record<string, unknown> = request.kind === 'options'
        ? await this.deps.portfolio.run(archived.dataset, request.execution, controller.signal)
        : await this.runResearch(archived.dataset, request, controller.signal);
      if (request.kind === 'options' && Array.isArray(result.equityCurve)) {
        const curve = result.equityCurve as { time: number; equity: string }[];
        result.equityObservations = curve.length;
        result.equityCurve = downsampleEquity(curve.map(p => p.time), curve.map(p => p.equity), LIMITS.equityCurvePoints);
      }
      if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024) throw new EngineError('RESOURCE_LIMIT', 'Research result exceeds 16 MiB. Reduce the range or order count.');
      const [saved] = await this.deps.db.update(backtestExperiments).set({ status: 'COMPLETED', result: { ...result, datasetChecksum: archived.checksum, engine: this.deps.engine.identity } })
        .where(and(eq(backtestExperiments.id, row.id), eq(backtestExperiments.status, 'RUNNING'))).returning({ id: backtestExperiments.id });
      return saved ? 'COMPLETED' : 'CANCELLED';
    } catch (error) {
      if (timedOut) throw new EngineError('TIMEOUT', 'Research exceeded its four-minute execution budget. Reduce the range, windows or candidate count.');
      if (controller.signal.aborted) return 'CANCELLED';
      if (error instanceof EngineError && error.retryable && !context.isLastAttempt) throw new RetryableJobError(error.message);
      throw error;
    } finally { clearInterval(watcher); clearTimeout(deadline); }
  }

  private async runResearch(dataset: MarketDataset, request: Exclude<Experiment, { kind: 'options' }>, signal: AbortSignal) {
    const instrument = dataset.instruments.find(i => i.id === request.instrumentId);
    if (!instrument) throw new Error('Instrument not found in dataset.');
    if (instrument.option) throw new Error('Option contracts require quote-based portfolio execution with margins and settlement.');
    if (dataset.provenance.adjustmentAsOf !== undefined && dataset.provenance.adjustmentAsOf > request.range.end) throw new Error('Adjusted data includes information after the experiment end. Supply a point-in-time dataset.');
    if (dataset.provenance.adjustment === 'raw' && dataset.corporateActions.some(a => a.instrumentId === instrument.id && a.effectiveAt >= request.range.start && a.effectiveAt < request.range.end)) {
      throw new Error('Raw candles cross a corporate action. Use quote-based portfolio execution or a declared adjusted dataset.');
    }
    const calendar = dataset.calendars[instrument.id];
    const candles = selectDatasetCandles(dataset, instrument.id, request.timeframe, request.range.start, request.range.end);
    const check = (bars: DatasetCandle[], start: number, end: number, minimum: number) => {
      if (calendar) {
        const expected = expectedSessionCandles(calendar, request.timeframe, start, end);
        if (bars.length < minimum || bars.length !== expected.length || bars.some((c, i) => c.openTime !== expected[i]!.openTime || c.closeTime !== expected[i]!.closeTime)) throw new Error('Historical range has missing session candles.');
      } else {
        const report = validateDataset(bars, request.timeframe, { start, end, now: this.deps.now().getTime() }, minimum);
        if (report.missing > 0) throw new Error('Imported research requires a complete candle grid; missing bars would distort walk-forward windows and statistics.');
      }
    };
    check(candles, request.range.start, request.range.end, 100);
    const evaluate = async ({ parameters: definition, candles: scored, phase }: { parameters: StrategyDefinition; candles: DatasetCandle[]; phase?: string }) => {
      if (signal.aborted) throw new EngineError('CANCELLED', 'Research cancelled.');
      const start = scored[0]!.openTime, end = scored.at(-1)!.closeTime + 1;
      if (dataset.provenance.adjustmentAsOf !== undefined && dataset.provenance.adjustmentAsOf > end) throw new Error('This research window requires adjustment information available by its own end date.');
      const warmupCount = Math.max(50, maxLookback(definition) * 5);
      const warmupStart = calendar ? calendarWarmupStart(calendar, request.timeframe, start, warmupCount) : candlesBefore(request.timeframe, alignDown(request.timeframe, start), warmupCount);
      if (dataset.provenance.adjustment === 'raw' && dataset.corporateActions.some(a => a.instrumentId === instrument.id && a.effectiveAt >= warmupStart && a.effectiveAt < end)) throw new Error('Raw indicator history crosses a corporate action, including warm-up. Supply a point-in-time adjusted research series or use quote replay.');
      const pre = selectDatasetCandles(dataset, instrument.id, request.timeframe, warmupStart, start);
      check(pre, warmupStart, start, warmupCount);
      const settings: BacktestSettings = {
        initialCapital: request.settings?.initialCapital ?? DEFAULTS.initialCapital,
        commissionPercent: request.settings?.commissionPercent ?? DEFAULTS.commissionPercent,
        slippageTicks: request.settings?.slippageTicks ?? DEFAULTS.slippageTicks,
        positionSizing: request.settings?.positionSizing ?? { type: 'percent_of_equity', value: String(definition.risk.positionSizePercent) },
        ...(request.settings?.execution && { execution: request.settings.execution }),
      };
      const actualDefinition = { ...definition, market: { exchange: instrument.exchange, symbol: instrument.symbol, timeframe: request.timeframe } };
      const result = await this.deps.engine.run({
        script: { language: 'pine', version: 6, generatedFrom: 'strategy_definition_v1', source: definitionToPine('Historical research', actualDefinition) },
        candles: [...pre, ...scored], timeframe: request.timeframe, tradingStartTime: start, settings,
        symbol: { exchange: instrument.exchange, symbol: instrument.symbol, baseAsset: instrument.symbol, quoteAsset: instrument.currency, tickSize: instrument.tickSize, lotSize: instrument.lotSize,
          assetType: instrument.assetClass === 'equity' ? 'stock' : 'crypto', timezone: calendar?.timezone ?? 'Etc/UTC', pointValue: instrument.pointValue },
      }, { signal, timeoutMs: SANDBOX_LIMITS.wallTimeoutMs });
      const metrics = { ...computeMetrics(result, scored, settings.initialCapital), ...(request.riskStatistics && { riskStatistics: computeRiskStatistics({ ...request.riskStatistics, equity: scored.map((c, i) => ({ time: c.openTime, equity: result.equity[i]! })) }) }) };
      const summaryOnly = phase === 'TRAIN' || phase === 'SENSITIVITY';
      const ranking = researchRanking(request.objective, metrics);
      return { score: ranking.rankingScore, rankingScore: ranking.rankingScore, objectiveValue: ranking.objectiveValue, metrics: { ...metrics, range: { start, end },
        equityCurve: summaryOnly ? [] : downsampleEquity(scored.map(c => c.openTime), result.equity, 500),
        trades: summaryOnly ? [] : result.trades.slice(0, 500),
        tradePreviewLimit: summaryOnly ? 0 : 500, tradesTruncated: result.trades.length > (summaryOnly ? 0 : 500),
        settings, executionAssumptions: result.executionAssumptions } };
    };
    const assumptions = ['Candle simulations use modeled fills and uniform commission; detailed historical fees, liquidity and settlement are applied in quote portfolio mode.', 'Each research window starts with fresh capital and indicators warmed only from earlier data.', selectionDescription(request.objective)];
    if (request.kind === 'single') return { kind: 'single', objective: request.objective, ...(await evaluate({ parameters: request.definitions[0]!, candles })), assumptions };
    const result = await evaluateWalkForward({ candles, config: request.walkForward!, candidates: request.definitions, evaluate });
    // Sensitivity uses training data only; it cannot select a candidate using the held-out results.
    const sensitivity = await compareParameterVariants({ candles: candles.slice(0, request.walkForward!.trainBars), candidates: request.definitions, evaluate });
    return { kind: 'walk_forward', objective: request.objective, selectionObjective: selectionDescription(request.objective), ...result, sensitivity, assumptions };
  }
}

export function experimentRoutes(service: BacktestExperiments, requireActiveUser: UserGuard) {
  const app = new Elysia({ prefix: '/api/v1/backtests' }).resolve(({ request }) => requireActiveUser(request));
  app.onError(({ error, set }) => {
    if (error instanceof z.ZodError) return validationError(Object.fromEntries(error.issues.slice(0, 30).map(i => [i.path.join('.'), i.message])));
    if (error instanceof BacktestError) {
      set.status = error.code === 'NOT_FOUND' ? 404 : error.code === 'TOO_MANY_ACTIVE' ? 429 : error.code === 'NOT_CANCELLABLE' ? 409 : 422;
      return { code: error.code, error: error.message };
    }
  });
  const id = (value: string | undefined) => z.uuid().parse(value);
  app.post('/datasets', async c => {
    const reader = c.request.body?.getReader();
    if (!reader) return validationError({ dataset: 'A JSON dataset is required.' });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 16 * 1024 * 1024) { await reader.cancel(); return Response.json({ code: 'UPLOAD_TOO_LARGE', error: 'Datasets are limited to 16 MiB per upload.' }, { status: 413 }); }
      chunks.push(next.value);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return validationError({ dataset: 'Invalid JSON.' }); }
    return Response.json(await service.import(c.user.id, value), { status: 201 });
  }, { parse: 'none' });
  app.get('/datasets', c => service.datasets(c.user.id));
  app.get('/datasets/:id', c => service.dataset(c.user.id, id(c.params.id)));
  app.post('/experiments', async c => {
    const parsed = await parseJson(c.request, experimentSchema);
    if ('response' in parsed) return parsed.response;
    return Response.json(await service.create(c.user.id, parsed.data), { status: 202 });
  }, { parse: 'none' });
  app.get('/experiments', c => service.list(c.user.id));
  app.get('/experiments/:id', c => service.get(c.user.id, id(c.params.id)));
  app.post('/experiments/:id/cancel', c => service.cancel(c.user.id, id(c.params.id)), { parse: 'none' });
  return app;
}
