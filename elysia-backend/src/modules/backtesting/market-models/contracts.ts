import { z } from 'zod';
import { dec } from '../utils/decimal';

/** Monetary values are strings; importing JSON numbers silently loses precision. */
export const decimalSchema = z.string().regex(/^\d{1,18}(\.\d{1,12})?$/, 'Use a non-negative decimal string with at most 12 decimal places.');
export const positiveDecimalSchema = decimalSchema.refine(v => dec.cmp(v, '0') > 0, 'Must be positive.');
export const timestampSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeId = z.string().min(1).max(128).refine(value => !Object.prototype.hasOwnProperty.call(Object.prototype, value) && value !== 'prototype', 'Instrument id is a reserved object property.');

export const instrumentContractSchema = z.strictObject({
  id: safeId,
  exchange: z.string().min(2).max(30),
  symbol: z.string().min(1).max(100),
  assetClass: z.enum(['crypto', 'equity', 'index_option', 'stock_option']),
  currency: z.string().min(3).max(10),
  tickSize: positiveDecimalSchema,
  /** Underlying units per lot. A quoted price is per unit, multiplied by pointValue. */
  lotSize: positiveDecimalSchema,
  pointValue: positiveDecimalSchema.default('1'),
  listedAt: timestampSchema,
  delistedAt: timestampSchema.optional(),
  option: z.strictObject({
    underlyingId: z.string().min(1).max(128),
    right: z.enum(['CALL', 'PUT']),
    strike: positiveDecimalSchema,
    expiry: timestampSchema,
    settlement: z.enum(['cash', 'physical']),
  }).optional(),
}).superRefine((v, ctx) => {
  const isOption = v.assetClass.endsWith('_option');
  if (isOption !== !!v.option) ctx.addIssue({ code: 'custom', path: ['option'], message: 'Option metadata is required only for option contracts.' });
  if (v.delistedAt !== undefined && v.delistedAt <= v.listedAt) ctx.addIssue({ code: 'custom', path: ['delistedAt'], message: 'Delisting must follow listing.' });
  if (v.option && v.option.expiry <= v.listedAt) ctx.addIssue({ code: 'custom', path: ['option', 'expiry'], message: 'Expiry must follow listing.' });
});

export type InstrumentContract = z.infer<typeof instrumentContractSchema>;

export function assertContractActive(instrument: InstrumentContract, time: number) {
  if (time < instrument.listedAt || (instrument.delistedAt !== undefined && time >= instrument.delistedAt) || (instrument.option && time >= instrument.option.expiry)) {
    throw new Error(`Instrument ${instrument.id} is not tradable at ${time}.`);
  }
}
