// Strategy definition language, engine v1: indicator conditions for entry/exit plus risk settings.
// zod is used as a pure schema library: the same schema validates input and is shown to AI models.
import { z } from 'zod';
import { TIMEFRAMES } from '../../market/domain/market-options';

export const ENGINE_VERSION = 'v1';

const period = (max: number) => z.number().int().min(2).max(max);

export const indicatorSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('PRICE') }).describe('Candle close price'),
  z.strictObject({ type: z.literal('VOLUME') }).describe('Candle volume'),
  z.strictObject({ type: z.literal('SMA'), period: period(400) }),
  z.strictObject({ type: z.literal('EMA'), period: period(400) }),
  z.strictObject({ type: z.literal('RSI'), period: period(100) }),
  z.strictObject({
    type: z.literal('MACD'),
    fast: period(100),
    slow: period(200),
    signal: period(100),
    line: z.enum(['MACD', 'SIGNAL', 'HISTOGRAM']),
  }),
  z.strictObject({ type: z.literal('BOLLINGER'), period: period(200), stdDev: z.number().min(0.5).max(5), band: z.enum(['UPPER', 'MIDDLE', 'LOWER']) }),
]);

export const conditionSchema = z.strictObject({
  left: indicatorSchema,
  operator: z.enum(['GT', 'LT', 'CROSSES_ABOVE', 'CROSSES_BELOW']),
  right: z.union([indicatorSchema, z.strictObject({ type: z.literal('VALUE'), value: z.number().finite() })]),
});

export const strategyDefinitionSchema = z
  .strictObject({
    market: z.strictObject({
      exchange: z.string().min(2).max(30).describe('Exchange code, e.g. BINANCE'),
      symbol: z.string().min(2).max(30).describe('Exchange symbol, e.g. BTCUSDT'),
      timeframe: z.enum(TIMEFRAMES),
    }),
    /** Spot accounts can only go long. */
    direction: z.literal('LONG'),
    entry: z.strictObject({ conditions: z.array(conditionSchema).min(1).max(5).describe('All must be true to enter') }),
    exit: z.strictObject({
      conditions: z.array(conditionSchema).max(5).describe('Any one true exits'),
      stopLossPercent: z.number().min(0.1).max(50).optional(),
      takeProfitPercent: z.number().min(0.1).max(500).optional(),
    }),
    risk: z.strictObject({ positionSizePercent: z.number().min(1).max(100).describe('Share of account balance per trade') }),
  })
  .refine(d => d.exit.conditions.length > 0 || d.exit.stopLossPercent !== undefined || d.exit.takeProfitPercent !== undefined, {
    message: 'A strategy needs at least one way to exit: an exit condition, a stop loss or a take profit.',
    path: ['exit'],
  })
  .refine(d => d.entry.conditions.concat(d.exit.conditions).every(c => c.left.type !== 'MACD' || c.left.fast < c.left.slow), {
    message: 'MACD fast period must be shorter than slow period.',
  });

export type StrategyDefinition = z.infer<typeof strategyDefinitionSchema>;
export type Condition = z.infer<typeof conditionSchema>;

export const strategyDraftSchema = z.strictObject({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(1000).optional(),
  definition: strategyDefinitionSchema,
});
export type StrategyDraft = z.infer<typeof strategyDraftSchema>;

export type DraftValidation = { ok: true; draft: StrategyDraft } | { ok: false; errors: Record<string, string> };

/** Structural validation, then normalization (upper-case market identifiers). */
export function validateStrategyDraft(input: unknown): DraftValidation {
  const parsed = strategyDraftSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[issue.path.join('.') || '(root)'] ??= issue.message;
    return { ok: false, errors };
  }
  const draft = parsed.data;
  draft.definition.market.exchange = draft.definition.market.exchange.toUpperCase();
  draft.definition.market.symbol = draft.definition.market.symbol.toUpperCase();
  return { ok: true, draft };
}

/** Human-readable one-line rule, for summaries and AI context. */
export function describeCondition(c: Condition): string {
  const ind = (i: Condition['left'] | Condition['right']): string => {
    switch (i.type) {
      case 'VALUE': return String(i.value);
      case 'PRICE': return 'price';
      case 'VOLUME': return 'volume';
      case 'SMA': case 'EMA': case 'RSI': return `${i.type}(${i.period})`;
      case 'MACD': return `MACD(${i.fast},${i.slow},${i.signal}).${i.line.toLowerCase()}`;
      case 'BOLLINGER': return `BB(${i.period},${i.stdDev}).${i.band.toLowerCase()}`;
    }
  };
  const op = { GT: '>', LT: '<', CROSSES_ABOVE: 'crosses above', CROSSES_BELOW: 'crosses below' }[c.operator];
  return `${ind(c.left)} ${op} ${ind(c.right)}`;
}
