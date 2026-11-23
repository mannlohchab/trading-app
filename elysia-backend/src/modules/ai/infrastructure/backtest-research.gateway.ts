import { z } from 'zod';
import { BacktestError, type BacktestingService } from '../../backtesting/backtesting.service';
import { experimentSchema, type BacktestExperiments } from '../../backtesting/backtesting.experiments';
import { backtestTimestampSchema, createBacktestSchema } from '../../backtesting/backtesting.schemas';
import { optionsExperimentSchema } from '../../backtesting/market-models/options';
import type { MarketDataset } from '../../backtesting/datasets/import';
import { describeCondition, strategyDefinitionSchema, strategyDraftSchema } from '../../strategies/domain/definition';
import type { StrategyService } from '../../strategies';

/** A persisted historical run always has an immutable strategy version and archived input. */
export const historicalRunSchema = z.strictObject({
  ...createBacktestSchema.shape,
  strategyId: z.uuid().optional(),
  draft: strategyDraftSchema.optional(),
}).refine(r => Number(!!r.strategyId) + Number(!!r.draft) === 1, 'Supply one saved strategyId or one draft.')
  .refine(r => !r.strategyVersionId || !!r.strategyId, 'strategyVersionId requires strategyId.')
  .refine(r => !r.range || r.candles === undefined, 'Choose a date range or candle count, not both.');

export const strategyListSchema = z.strictObject({ limit: z.number().int().min(1).max(30).default(20), offset: z.number().int().min(0).max(10000).default(0) });
export const researchListSchema = z.strictObject({
  limit: z.number().int().min(1).max(30).default(20), before: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(), strategyId: z.uuid().optional(),
});
export const researchTradesSchema = z.strictObject({ limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).max(200000).default(0) });
export const researchEquitySchema = z.strictObject({ maxPoints: z.number().int().min(10).max(200).default(100) });
export const datasetMetadataSchema = z.strictObject({ instrumentId: z.string().min(1).max(128).optional(), limit: z.number().int().min(1).max(30).default(20), offset: z.number().int().min(0).max(1000).default(0) });

/** ISO offsets are accepted at the chat boundary; execution receives normalized UTC milliseconds. */
export const researchExperimentSchema = z.discriminatedUnion('kind', [
  experimentSchema.options[0].extend({ range: z.strictObject({ start: backtestTimestampSchema, end: backtestTimestampSchema }) }),
  experimentSchema.options[1].extend({ execution: z.strictObject({ ...optionsExperimentSchema.shape,
    start: backtestTimestampSchema, end: backtestTimestampSchema,
    orders: z.array(optionsExperimentSchema.shape.orders.element.extend({ time: backtestTimestampSchema })).max(10000),
  }).superRefine((value, ctx) => {
    const checked = optionsExperimentSchema.safeParse(value);
    if (!checked.success) for (const issue of checked.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }) }),
]);

const uuid = z.uuid();
const OMIT_MODEL_KEYS = new Set(['script', 'definition', 'definitions', 'parameters', 'payload', 'request']);

/** Keep stored results intact while bounding the material sent into the model's context. */
export function compactResearchResult(value: unknown, budget = 16000): { data: unknown; truncated: boolean; notice: string | null } {
  let remaining = budget, truncated = false;
  const visit = (v: unknown, depth = 0): unknown => {
    if (remaining <= 0 || depth > 9) { truncated = true; return '[omitted: response limit]'; }
    if (typeof v === 'string') {
      const limit = Math.min(remaining, 1200); remaining -= Math.min(v.length, limit) + 8;
      if (v.length > limit) { truncated = true; return `${v.slice(0, limit)}…`; }
      return v;
    }
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) {
      const limit = Math.min(v.length, 20); if (limit < v.length) truncated = true;
      const items: unknown[] = [];
      for (const item of v.slice(0, limit)) { if (remaining <= 0) { truncated = true; break; } items.push(visit(item, depth + 1)); }
      return items;
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = Object.create(null);
      for (const [key, item] of Object.entries(v)) {
        if (OMIT_MODEL_KEYS.has(key)) continue;
        if (remaining <= 0) { truncated = true; break; }
        remaining -= key.length + 8;
        out[key] = visit(item, depth + 1);
        if (Array.isArray(item) && item.length > 20) out[`${key}Total`] = item.length;
      }
      return out;
    }
    remaining -= 32;
    return v;
  };
  const data = visit(value);
  // JSON escaping and multibyte input can be larger than the character budget.
  if (Buffer.byteLength(JSON.stringify(data) ?? '') > 48000 && budget > 1000) return compactResearchResult(value, Math.floor(budget / 2));
  return { data, truncated, notice: truncated ? 'Model response is a bounded preview. Open the saved research run for its retained results; omitted rows are not included in this response.' : null };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const select = (value: unknown, keys: string[]) => Object.fromEntries(keys.filter(key => object(value)[key] !== undefined).map(key => [key, object(value)[key]]));

/** Report every held-out fold before spending context on diagnostic trade/curve samples. */
export function compactExperimentResult(result: Record<string, unknown>, definitions?: unknown) {
  if (result.kind !== 'walk_forward') return compactResearchResult({ warnings: result.warnings, assumptions: result.assumptions, ...result });
  const metricKeys = ['totalReturnPercent', 'netProfit', 'maxDrawdownPercent', 'intrabarMaxDrawdownPercent', 'winRatePercent', 'totalTrades', 'profitFactor', 'finalEquity'];
  const sensitivity = object(result.sensitivity);
  const windows = array(result.windows).map(value => {
    const window = object(value), heldOut = object(window.outOfSample), metrics = object(heldOut.metrics);
    return { window: window.window, selectedCandidate: window.selectedCandidate, trainRange: window.trainRange, testRange: window.testRange,
      outOfSample: { score: heldOut.score, rankingScore: heldOut.rankingScore ?? heldOut.score, objectiveValue: heldOut.objectiveValue, metrics: select(metrics, metricKeys), settings: metrics.settings,
        ...(metrics.riskStatistics ? { riskStatistics: select(metrics.riskStatistics, ['sharpe', 'sortino', 'cagrPercent', 'annualizedVolatilityPercent', 'observations', 'reason']) } : {}) },
      training: array(window.training).map(candidate => select(candidate, ['candidateIndex', 'score', 'rankingScore', 'objectiveValue'])),
    };
  });
  const firstMetrics = object(object(object(array(result.windows)[0]).outOfSample).metrics);
  const candidates = array(definitions).map((value, candidateIndex) => {
    const checked = strategyDefinitionSchema.safeParse(value);
    if (!checked.success) return { candidateIndex, rulesUnavailable: true };
    const d = checked.data;
    return { candidateIndex, direction: d.direction, entryConditions: d.entry.conditions.map(describeCondition), pyramiding: d.entry.pyramiding ?? 1,
      exitConditions: d.exit.conditions.map(describeCondition), stopLossPercent: d.exit.stopLossPercent, takeProfitPercent: d.exit.takeProfitPercent,
      trailingStop: d.exit.trailingStop, partialTakeProfits: d.exit.partialTakeProfits, positionSizePercent: d.risk.positionSizePercent };
  });
  return compactResearchResult({ kind: result.kind, warnings: result.warnings, assumptions: result.assumptions, engine: result.engine, datasetChecksum: result.datasetChecksum,
    objective: result.objective ?? 'total_return', selectionObjective: result.selectionObjective ?? 'Maximize training totalReturnPercent; freeze the selected candidate before each held-out window.', windows, evaluatedCandidates: result.evaluatedCandidates,
    sensitivity: { ...select(sensitivity, ['minimumScore', 'maximumScore', 'medianScore', 'warnings']), results: array(sensitivity.results).map(candidate => select(candidate, ['index', 'score', 'rankingScore', 'objectiveValue'])) },
    executionAssumptions: firstMetrics.executionAssumptions, riskStatisticsAssumptions: object(firstMetrics.riskStatistics).assumptions, candidates,
    detailNote: 'Each test window starts a fresh account. Training scores are parameter-selection scores. Diagnostic trades, curves and other metrics remain in the saved research result.',
  }, 40000);
}

function backtestView<T extends { script?: unknown }>(run: T) {
  const { script: _script, ...visible } = run;
  return visible;
}

function timeCoverage(events: { time: number; receivedAt?: number; availableAt?: number }[]) {
  if (!events.length) return null;
  let start = Infinity, end = -Infinity, firstAvailable = Infinity, lastAvailable = -Infinity;
  for (const e of events) {
    start = Math.min(start, e.time); end = Math.max(end, e.time);
    const available = e.receivedAt ?? e.availableAt ?? e.time;
    firstAvailable = Math.min(firstAvailable, available); lastAvailable = Math.max(lastAvailable, available);
  }
  return { events: events.length, firstEvent: start, lastEvent: end, firstAvailable, lastAvailable };
}

function datasetMetadata(dataset: MarketDataset, options: z.infer<typeof datasetMetadataSchema>) {
  const selected = options.instrumentId ? dataset.instruments.filter(i => i.id === options.instrumentId) : dataset.instruments;
  if (options.instrumentId && !selected.length) throw new BacktestError('NOT_FOUND', 'Instrument not found in dataset.');
  const instruments = selected.slice(options.offset, options.offset + options.limit);
  const ids = new Set(instruments.map(i => i.id));
  const candles = new Map<string, { instrumentId: string; timeframe: string; start: number; end: number; candles: number }>();
  for (const c of dataset.candles) if (ids.has(c.instrumentId)) {
    const key = JSON.stringify([c.instrumentId, c.timeframe]), prior = candles.get(key);
    if (prior) { prior.start = Math.min(prior.start, c.openTime); prior.end = Math.max(prior.end, c.closeTime + 1); prior.candles++; }
    else candles.set(key, { instrumentId: c.instrumentId, timeframe: c.timeframe, start: c.openTime, end: c.closeTime + 1, candles: 1 });
  }
  return {
    provenance: dataset.provenance, instrumentTotal: selected.length, offset: options.offset, limit: options.limit,
    nextOffset: options.offset + instruments.length < selected.length ? options.offset + instruments.length : null,
    instruments: instruments.map(instrument => {
      const calendar = dataset.calendars[instrument.id];
      const fees = dataset.feeSchedules.filter(f => f.exchange === instrument.exchange && f.assetClass === instrument.assetClass);
      const margins = dataset.marginSnapshots.filter(m => m.positions.some(p => p.instrumentId === instrument.id));
      const settlements = dataset.settlements.filter(s => s.instrumentId === instrument.id);
      return { ...instrument,
        candleRanges: [...candles.values()].filter(c => c.instrumentId === instrument.id),
        quotes: timeCoverage(dataset.quotes.filter(q => q.instrumentId === instrument.id)),
        trades: timeCoverage(dataset.trades.filter(q => q.instrumentId === instrument.id)),
        calendar: calendar ? { timezone: calendar.timezone, source: calendar.source, version: calendar.version, coverageStart: calendar.coverageStart, coverageEnd: calendar.coverageEnd, sessionCount: calendar.sessions.length, firstSession: calendar.sessions[0], lastSession: calendar.sessions.at(-1) } : null,
        feeSchedules: fees.slice(0, 20).map(({ id, source, validFrom, validTo, components }) => ({ id, source, validFrom, validTo, componentNames: components.map(c => c.name) })),
        feeScheduleCount: fees.length, feeSchedulesTruncated: fees.length > 20,
        margins: timeCoverage(margins), marginNote: 'Coverage extrema do not establish that every time or required portfolio has a margin snapshot.',
        settlements, corporateActionCount: dataset.corporateActions.filter(a => a.instrumentId === instrument.id).length,
      };
    }),
    coverageNote: 'Ranges show observed extrema, not a guarantee of complete history. The engine validates warm-up, gaps, sessions, quotes, margins and settlements for each requested run.',
  };
}

/** All reads/mutations are scoped to the authenticated user passed by the tool adapter. */
export function backtestResearchGateway(deps: { backtests: BacktestingService; experiments: BacktestExperiments; strategies: StrategyService }) {
  return {
    async strategies(userId: string, options: z.input<typeof strategyListSchema> = {}) {
      const { limit, offset } = strategyListSchema.parse(options);
      const page = await deps.strategies.list(userId, limit, offset);
      return { ...page, limit, offset, nextOffset: offset + page.items.length < page.total ? offset + page.items.length : null };
    },
    async strategy(userId: string, id: string) {
      const found = await deps.strategies.get(userId, uuid.parse(id));
      if (!found) throw new BacktestError('STRATEGY_NOT_FOUND', 'Strategy not found.');
      return found;
    },
    async create(userId: string, raw: z.input<typeof historicalRunSchema>) {
      const { draft, strategyId, ...options } = historicalRunSchema.parse(raw);
      if (draft) {
        const checked = await deps.backtests.validateDraftRun(userId, draft, options);
        const saved = await deps.strategies.create(userId, checked, 'AI_GENERATED', { origin: 'ai_historical_backtest' });
        if (!saved.ok) throw new BacktestError('VALIDATION_ERROR', 'Strategy could not be saved.', { fields: saved.errors });
        return backtestView(await deps.backtests.create(userId, { ...options, strategyId: saved.strategy.id, strategyVersionId: saved.strategy.versionId }));
      }
      return backtestView(await deps.backtests.create(userId, { ...options, strategyId: strategyId! }));
    },
    async list(userId: string, raw: z.input<typeof researchListSchema> = {}) {
      const { before, ...options } = researchListSchema.parse(raw);
      return deps.backtests.list(userId, { ...options, ...(before && { before: new Date(before) }) });
    },
    async get(userId: string, id: string) { return backtestView(await deps.backtests.get(userId, uuid.parse(id))); },
    async trades(userId: string, id: string, raw: z.input<typeof researchTradesSchema> = {}) {
      const { limit, offset } = researchTradesSchema.parse(raw);
      const result = await deps.backtests.trades(userId, uuid.parse(id), limit, offset);
      return { ...result, nextOffset: offset + result.trades.length < result.total ? offset + result.trades.length : null };
    },
    async equity(userId: string, id: string, raw: z.input<typeof researchEquitySchema> = {}) { return deps.backtests.equityCurve(userId, uuid.parse(id), researchEquitySchema.parse(raw).maxPoints); },
    async cancel(userId: string, id: string) { return backtestView(await deps.backtests.cancel(userId, uuid.parse(id))); },
    async replay(userId: string, id: string) { return backtestView(await deps.backtests.replay(userId, uuid.parse(id))); },
    async datasets(userId: string) {
      const { datasets } = await deps.experiments.datasets(userId);
      return { datasets: datasets.map(d => {
        const summary = d as typeof d & { instruments?: unknown[]; ranges?: unknown[]; candleCount?: number; quoteCount?: number };
        return { id: d.id, name: d.name, checksum: d.checksum, createdAt: d.createdAt, candleCount: summary.candleCount, quoteCount: summary.quoteCount,
          instrumentCount: summary.instruments?.length ?? 0, instruments: summary.instruments?.slice(0, 5), ranges: summary.ranges?.slice(0, 5),
          metadataTruncated: (summary.instruments?.length ?? 0) > 5 || (summary.ranges?.length ?? 0) > 5 };
      }), note: 'Read an individual dataset for paginated instrument coverage, quote availability, sessions, fees, margin and settlement metadata.' };
    },
    async dataset(userId: string, id: string, options: z.input<typeof datasetMetadataSchema> = {}) {
      const { dataset, ...meta } = await deps.experiments.dataset(userId, uuid.parse(id));
      return { id: meta.id, name: meta.name, checksum: meta.checksum, createdAt: meta.createdAt, ...compactResearchResult(datasetMetadata(dataset, datasetMetadataSchema.parse(options))) };
    },
    async importDataset(userId: string, document: unknown) {
      if (Buffer.byteLength(JSON.stringify(document) ?? '') > 16 * 1024 * 1024) throw new BacktestError('RANGE_TOO_LARGE', 'Dataset imports are limited to 16 MiB.');
      const result = await deps.experiments.import(userId, document);
      return { id: result.id, name: result.name, checksum: result.checksum, createdAt: result.createdAt, ...compactResearchResult(result) };
    },
    async createExperiment(userId: string, raw: z.input<typeof researchExperimentSchema>) {
      const row = await deps.experiments.create(userId, researchExperimentSchema.parse(raw));
      return { id: row.id, datasetId: row.datasetId, kind: row.kind, status: row.status, createdAt: row.createdAt };
    },
    async listExperiments(userId: string) {
      const { experiments } = await deps.experiments.list(userId);
      return { experiments: experiments.slice(0, 30).map(({ id, datasetId, kind, status, error, createdAt, completed }) => ({ id, datasetId, kind, status, error, createdAt, completed })), retainedRecentLimit: 30 };
    },
    async getExperiment(userId: string, id: string) {
      const row = await deps.experiments.get(userId, uuid.parse(id));
      const { definitions: _defs, execution, ...request } = row.request;
      const executionSummary = execution && typeof execution === 'object' ? Object.fromEntries(Object.entries(execution).filter(([key]) => key !== 'orders' && key !== 'initialHoldings')) : undefined;
      return { id: row.id, datasetId: row.datasetId, kind: row.kind, status: row.status, error: row.error, createdAt: row.createdAt,
        request: { ...request, ...(executionSummary && { execution: executionSummary }) },
        result: row.result ? compactExperimentResult(row.result, _defs) : null };
    },
    async cancelExperiment(userId: string, id: string) {
      const row = await deps.experiments.cancel(userId, uuid.parse(id));
      return { id: row.id, datasetId: row.datasetId, kind: row.kind, status: row.status, error: row.error, createdAt: row.createdAt };
    },
  };
}

export type BacktestResearchGateway = ReturnType<typeof backtestResearchGateway>;
