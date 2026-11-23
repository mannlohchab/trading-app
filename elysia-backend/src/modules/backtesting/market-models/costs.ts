import { z } from 'zod';
import { dec } from '../utils/decimal';
import { decimalSchema, timestampSchema, type InstrumentContract } from './contracts';

/** No current tax rates are baked into historical results. Supply sourced effective-dated rates. */
export const feeScheduleSchema = z.strictObject({
  id: z.string().min(1).max(128), source: z.string().min(1).max(500),
  exchange: z.string().min(2).max(30),
  assetClass: z.enum(['crypto', 'equity', 'index_option', 'stock_option']),
  validFrom: timestampSchema, validTo: timestampSchema,
  components: z.array(z.strictObject({
    name: z.string().min(1).max(80),
    side: z.enum(['BUY', 'SELL', 'BOTH']).default('BOTH'),
    event: z.enum(['TRADE', 'EXERCISE', 'BOTH']).default('TRADE'),
    basis: z.enum(['turnover', 'underlying_notional', 'fees']),
    feeNames: z.array(z.string().min(1).max(80)).max(20).optional(),
    ratePercent: decimalSchema.default('0'), flat: decimalSchema.default('0'),
    minimum: decimalSchema.optional(), maximum: decimalSchema.optional(),
    roundPlaces: z.number().int().min(0).max(12).default(2),
  })).max(30),
}).superRefine((v, ctx) => {
  if (v.validTo <= v.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Fee validity end must follow start.' });
  const names = new Set<string>();
  for (const [i, component] of v.components.entries()) {
    if (names.has(component.name)) ctx.addIssue({ code: 'custom', path: ['components', i, 'name'], message: 'Fee component names must be unique.' });
    if (component.basis === 'fees' && (!component.feeNames?.length || component.feeNames.some(n => !names.has(n)))) ctx.addIssue({ code: 'custom', path: ['components', i, 'feeNames'], message: 'Tax-on-fees must name earlier fee components.' });
    if (component.minimum && component.maximum && dec.cmp(component.minimum, component.maximum) > 0) ctx.addIssue({ code: 'custom', path: ['components', i], message: 'Minimum cannot exceed maximum.' });
    names.add(component.name);
  }
});
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;

export function calculateExecutionCosts(schedules: FeeSchedule[], input: {
  instrument: InstrumentContract; time: number; side: 'BUY' | 'SELL'; price: string; quantity: string;
  underlyingPrice?: string; event?: 'TRADE' | 'EXERCISE';
}) {
  const matching = schedules.filter(s => s.exchange === input.instrument.exchange && s.assetClass === input.instrument.assetClass && s.validFrom <= input.time && input.time < s.validTo);
  if (matching.length !== 1) throw new Error(`Exactly one effective fee schedule is required for ${input.instrument.id} at ${input.time}.`);
  const schedule = matching[0]!;
  const turnover = dec.mul(dec.mul(input.price, input.quantity), input.instrument.pointValue);
  // Component names come from user-owned imports; dictionary keys must not invoke __proto__.
  const amounts: Record<string, string> = Object.create(null);
  for (const fee of schedule.components) {
    if ((fee.side !== 'BOTH' && fee.side !== input.side) || (fee.event !== 'BOTH' && fee.event !== (input.event ?? 'TRADE'))) { amounts[fee.name] = '0'; continue; }
    let basis = turnover;
    if (fee.basis === 'fees') basis = dec.sum(fee.feeNames!.map(n => amounts[n] ?? '0'));
    if (fee.basis === 'underlying_notional') {
      if (input.underlyingPrice === undefined) throw new Error(`${fee.name} requires an underlying price.`);
      basis = dec.mul(dec.mul(input.underlyingPrice, input.quantity), input.instrument.pointValue);
    }
    let amount = dec.add(dec.div(dec.mul(basis, fee.ratePercent), '100'), fee.flat);
    if (fee.minimum) amount = dec.max([amount, fee.minimum]);
    if (fee.maximum) amount = dec.min([amount, fee.maximum]);
    amounts[fee.name] = dec.round(amount, fee.roundPlaces);
  }
  return { scheduleId: schedule.id, components: amounts, total: dec.sum(Object.values(amounts)) };
}
