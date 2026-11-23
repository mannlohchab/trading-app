import { z } from 'zod';
import type { DatasetCandle } from '../backtesting.types';
import { dec } from '../utils/decimal';
import { positiveDecimalSchema, timestampSchema } from './contracts';

export const corporateActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ id: z.string().min(1), instrumentId: z.string().min(1), source: z.string().min(1), declaredAt: timestampSchema, effectiveAt: timestampSchema, type: z.literal('SPLIT'), newUnitsPerOldUnit: positiveDecimalSchema }),
  z.strictObject({ id: z.string().min(1), instrumentId: z.string().min(1), source: z.string().min(1), declaredAt: timestampSchema, effectiveAt: timestampSchema, payableAt: timestampSchema, type: z.literal('DIVIDEND'), amountPerUnit: positiveDecimalSchema }),
]);
export type CorporateAction = z.infer<typeof corporateActionSchema>;

/** Explicit research series, never silently substituted for raw executable prices. */
export function adjustHistoricalCandles(candles: DatasetCandle[], actions: CorporateAction[], input: {
  instrumentId: string; asOf: number; mode: 'split_adjusted' | 'total_return';
}) {
  const selected = actions.filter(a => a.instrumentId === input.instrumentId && a.declaredAt <= input.asOf && a.effectiveAt <= input.asOf).sort((a, b) => b.effectiveAt - a.effectiveAt);
  const out = candles.map(c => ({ ...c }));
  for (const action of selected) {
    if (action.type === 'SPLIT') {
      for (const c of out) if (c.openTime < action.effectiveAt) {
        for (const key of ['open', 'high', 'low', 'close'] as const) c[key] = dec.div(c[key], action.newUnitsPerOldUnit);
        c.volume = dec.mul(c.volume, action.newUnitsPerOldUnit);
      }
    } else if (input.mode === 'total_return') {
      const prior = candles.filter(c => c.closeTime < action.effectiveAt).at(-1);
      if (!prior || dec.cmp(prior.close, action.amountPerUnit) <= 0) throw new Error(`A valid preceding raw close is needed for dividend ${action.id}.`);
      const factor = dec.div(dec.sub(prior.close, action.amountPerUnit), prior.close);
      for (const c of out) if (c.openTime < action.effectiveAt) for (const key of ['open', 'high', 'low', 'close'] as const) c[key] = dec.mul(c[key], factor);
    }
  }
  return { candles: out, adjustment: input.mode, asOf: input.asOf, actionIds: selected.filter(a => a.type === 'SPLIT' || input.mode === 'total_return').map(a => a.id) };
}

/** Raw-price portfolio bookkeeping at a split boundary. Fractional units remain explicit. */
export function applySplitToPosition(position: { quantity: string; averagePrice: string }, action: Extract<CorporateAction, { type: 'SPLIT' }>) {
  return { quantity: dec.mul(position.quantity, action.newUnitsPerOldUnit), averagePrice: dec.div(position.averagePrice, action.newUnitsPerOldUnit) };
}
