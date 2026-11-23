import { z } from 'zod';
import { TIMEFRAMES } from '../../market/domain/market-options';
const symbol = z.string().min(2).max(30);

const INDICATOR_FIELDS: Record<string, string[]> = {
  PRICE: [], VOLUME: [], SMA: ['period'], EMA: ['period'], RSI: ['period'],
  MACD: ['fast', 'slow', 'signal', 'line'], BOLLINGER: ['period', 'stdDev', 'band'], VALUE: ['value'],
};
const looseIndicator = z
  .strictObject({
    type: z.enum(['PRICE', 'VOLUME', 'SMA', 'EMA', 'RSI', 'MACD', 'BOLLINGER', 'VALUE']),
    period: z.number().nullish(),
    value: z.number().nullish(),
    fast: z.number().nullish(),
    slow: z.number().nullish(),
    signal: z.number().nullish(),
    line: z.enum(['MACD', 'SIGNAL', 'HISTOGRAM']).nullish(),
    stdDev: z.number().nullish(),
    band: z.enum(['UPPER', 'MIDDLE', 'LOWER']).nullish(),
  })
  .describe('PRICE/VOLUME: no params. SMA/EMA/RSI: period. MACD: fast, slow, signal, line. BOLLINGER: period, stdDev, band. VALUE (right side only): value.');
const looseCondition = z.strictObject({
  left: looseIndicator,
  operator: z.enum(['GT', 'LT', 'CROSSES_ABOVE', 'CROSSES_BELOW']),
  right: z.union([looseIndicator, z.number()]).describe('An indicator, or a plain number such as 30'),
});
export const looseDraft = z.strictObject({
  name: z.string().describe('Short strategy name'),
  description: z.string().nullish().describe('One or two sentences: the idea behind it'),
  definition: z.strictObject({
    market: z.strictObject({ exchange: z.string().describe('BINANCE'), symbol, timeframe: z.enum(TIMEFRAMES) }),
    direction: z.enum(['LONG', 'SHORT']).describe('Default LONG. SHORT only when explicitly requested for historical research; unavailable in paper trading.'),
    entry: z.strictObject({
      conditions: z.array(looseCondition).describe('1-5 conditions, ALL must hold to enter'),
      pyramiding: z.number().nullish().describe('Optional integer 1-10, maximum simultaneous entries. Omit for one entry; values above one are backtest-only and require an explicit request.'),
    }),
    exit: z.strictObject({
      conditions: z.array(looseCondition).describe('0-5 conditions, ANY one exits'),
      stopLossPercent: z.number().nullish().describe('0.1-50'),
      takeProfitPercent: z.number().nullish().describe('0.1-500'),
      trailingStop: z.strictObject({
        activationPercent: z.number().describe('Favorable price move to activate, 0-500; below 100 for SHORT'),
        offsetPercent: z.number().describe('Trailing distance as percent of entry price, 0.1-50'),
      }).nullish().describe('Optional backtest-only trailing stop. Include only when explicitly requested.'),
      partialTakeProfits: z.array(z.strictObject({
        profitPercent: z.number().describe('Favorable price move, 0.1-500; below 100 for SHORT'),
        quantityPercent: z.number().describe('Portion of position to exit, greater than 0 and at most 100'),
      })).nullish().describe('Optional backtest-only partial exits, 1-5 targets; quantities total at most 100%. Include only when explicitly requested.'),
    }),
    risk: z.strictObject({ positionSizePercent: z.number().describe('1-100, share of balance per trade') }),
  }),
});

/** Drops nulls and fields that don't belong to an indicator's type, so the strict schema can judge the rest. */
export function normalizeDraft(draft: z.infer<typeof looseDraft>): unknown {
  const indicator = (i: z.infer<typeof looseIndicator>) =>
    Object.fromEntries([['type', i.type], ...(INDICATOR_FIELDS[i.type] ?? []).flatMap(k => (i as any)[k] == null ? [] : [[k, (i as any)[k]]])]);
  const condition = (c: z.infer<typeof looseCondition>) => ({
    left: indicator(c.left),
    operator: c.operator,
    right: typeof c.right === 'number' ? { type: 'VALUE', value: c.right } : indicator(c.right),
  });
  const d = draft.definition;
  return {
    name: draft.name,
    ...(draft.description ? { description: draft.description } : {}),
    definition: {
      market: d.market,
      direction: d.direction,
      entry: {
        conditions: d.entry.conditions.map(condition),
        ...(d.entry.pyramiding != null && { pyramiding: d.entry.pyramiding }),
      },
      exit: {
        conditions: d.exit.conditions.map(condition),
        ...(d.exit.stopLossPercent != null && { stopLossPercent: d.exit.stopLossPercent }),
        ...(d.exit.takeProfitPercent != null && { takeProfitPercent: d.exit.takeProfitPercent }),
        ...(d.exit.trailingStop != null && { trailingStop: d.exit.trailingStop }),
        ...(d.exit.partialTakeProfits != null && { partialTakeProfits: d.exit.partialTakeProfits }),
      },
      risk: d.risk,
    },
  };
}
