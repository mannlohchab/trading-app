// Request validation (zod) for the backtesting API.
import { z } from 'zod';
import { TIMEFRAMES } from '../market/domain/market-options';
import { strategyDefinitionSchema } from '../strategies/domain/definition';
import { LIMITS } from './backtesting.constants';

const decimalString = (max: string, { allowZero = false } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform(v => String(v).trim())
    .refine(v => /^\d+(\.\d{1,12})?$/.test(v), 'Use a plain decimal number such as 10000 or 0.1.')
    .refine(v => (allowZero ? Number(v) >= 0 : Number(v) > 0), allowZero ? 'Must be zero or more.' : 'Must be greater than zero.')
    .refine(v => Number(v) <= Number(max), `Must be at most ${max}.`);

/** ISO-8601 timestamp or Unix milliseconds, interpreted in UTC. */
export const backtestTimestampSchema = z.union([
  z.number().int().nonnegative().max(8_640_000_000_000_000),
  z.string().datetime({ offset: true }).transform(v => Date.parse(v)),
]);

export const positionSizingSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('percent_of_equity'), value: decimalString('100') }),
  z.strictObject({ type: z.literal('cash'), value: decimalString(LIMITS.initialCapitalMax) }),
  z.strictObject({ type: z.literal('fixed_quantity'), value: decimalString('1000000000') }),
]);

export const settingsSchema = z.strictObject({
  initialCapital: decimalString(LIMITS.initialCapitalMax).optional().describe('Starting simulated capital in the symbol quote currency; no implicit currency conversion.'),
  commissionPercent: decimalString(LIMITS.commissionPercentMax, { allowZero: true }).optional().describe('Commission percent of traded value per side: 0.1 means 0.1%, not 10%.'),
  slippageTicks: z.number().int().min(0).max(LIMITS.slippageTicksMax).optional().describe('Adverse price movement in instrument ticks, not percent or basis points.'),
  positionSizing: positionSizingSchema.optional(),
  execution: z.strictObject({
    spreadTicks: z.number().int().min(0).max(10_000).optional().describe('Modeled full bid/ask spread in instrument ticks.'),
    maxVolumeParticipationPercent: decimalString('100').optional().describe('Entry-volume cap as a percent of the preceding closed candle volume; 1 means 1%.'),
  }).optional(),
});

export const riskStatisticsSchema = z.strictObject({
  periodsPerYear: z.number().finite().positive().max(1_000_000_000).describe('Explicit number of sampled trading periods per year, consistent with the chosen candle timeframe.'),
  annualRiskFreeRate: z.number().finite().gt(-1).max(10).default(0).describe('Annual risk-free rate as a decimal fraction: 0.06 means 6%.'),
});

export const backtestMarketSchema = z.strictObject({
  exchange: z.string().min(2).max(30).optional(),
  symbol: z.string().min(2).max(30).optional(),
  timeframe: z.enum(TIMEFRAMES).optional(),
});

export const backtestRangeSchema = z.strictObject({
  start: backtestTimestampSchema.optional(), end: backtestTimestampSchema.optional(),
}).refine(r => r.start !== undefined || r.end !== undefined, 'Supply a start or end for the range.')
  .refine(r => r.start === undefined || r.end === undefined || r.end > r.start, 'The range end must be after its start.');

export const createBacktestSchema = z.strictObject({
  strategyId: z.uuid(),
  /** Exact immutable version; defaults to the latest. */
  strategyVersionId: z.uuid().optional(),
  market: backtestMarketSchema.optional(),
  range: backtestRangeSchema.optional(),
  candles: z.number().int().min(LIMITS.minCandles).max(LIMITS.maxCandles).optional(),
  settings: settingsSchema.optional(),
  riskStatistics: riskStatisticsSchema.optional(),
}).refine(r => !r.range || r.candles === undefined, 'Choose a date range or candle count, not both.');
export type CreateBacktestRequest = z.infer<typeof createBacktestSchema>;

export const previewBacktestSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  definition: z.unknown(),
  market: backtestMarketSchema.optional(),
  candles: z.number().int().min(LIMITS.minCandles).max(LIMITS.maxPreviewCandles).optional(),
  range: backtestRangeSchema.optional(),
  settings: settingsSchema.optional(),
  riskStatistics: riskStatisticsSchema.optional(),
}).refine(r => !r.range || r.candles === undefined, 'Choose a date range or candle count, not both.');
export type PreviewBacktestRequest = z.infer<typeof previewBacktestSchema>;

export const listBacktestsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  strategyId: z.uuid().optional(),
});

export const tradesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(LIMITS.maxTrades).default(0),
});

export const equityQuery = z.object({
  maxPoints: z.coerce.number().int().min(10).max(LIMITS.equityCurvePoints).default(500),
});

export { strategyDefinitionSchema };
