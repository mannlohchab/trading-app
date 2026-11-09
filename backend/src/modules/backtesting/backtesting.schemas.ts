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
const timestamp = z.union([
  z.number().int().nonnegative(),
  z.string().datetime({ offset: true }).transform(v => Date.parse(v)),
]);

export const positionSizingSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('percent_of_equity'), value: decimalString('100') }),
  z.strictObject({ type: z.literal('cash'), value: decimalString(LIMITS.initialCapitalMax) }),
  z.strictObject({ type: z.literal('fixed_quantity'), value: decimalString('1000000000') }),
]);

export const settingsSchema = z.strictObject({
  initialCapital: decimalString(LIMITS.initialCapitalMax).optional(),
  commissionPercent: decimalString(LIMITS.commissionPercentMax, { allowZero: true }).optional(),
  slippageTicks: z.number().int().min(0).max(LIMITS.slippageTicksMax).optional(),
  positionSizing: positionSizingSchema.optional(),
});

const marketOverride = z.strictObject({
  exchange: z.string().min(2).max(30).optional(),
  symbol: z.string().min(2).max(30).optional(),
  timeframe: z.enum(TIMEFRAMES).optional(),
});

export const createBacktestSchema = z.strictObject({
  strategyId: z.uuid(),
  /** Exact immutable version; defaults to the latest. */
  strategyVersionId: z.uuid().optional(),
  market: marketOverride.optional(),
  range: z.strictObject({ start: timestamp.optional(), end: timestamp.optional() }).optional(),
  settings: settingsSchema.optional(),
});
export type CreateBacktestRequest = z.infer<typeof createBacktestSchema>;

export const previewBacktestSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  definition: z.unknown(),
  candles: z.number().int().min(LIMITS.minCandles).max(LIMITS.maxPreviewCandles).optional(),
  settings: settingsSchema.optional(),
});
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
