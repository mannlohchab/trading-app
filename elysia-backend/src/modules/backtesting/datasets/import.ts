import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TIMEFRAMES, type Timeframe } from '../../market/domain/market-options';
import { dec } from '../utils/decimal';
import { decimalSchema, instrumentContractSchema, positiveDecimalSchema, timestampSchema } from '../market-models/contracts';
import { sessionCalendarSchema, expectedSessionCandles, isTradingTime, matchesIntradaySessionCandle } from '../market-models/calendar';
import { corporateActionSchema } from '../market-models/corporate-actions';
import { feeScheduleSchema } from '../market-models/costs';
import { isAligned, nextOpenTime } from '../utils/validation';

export const historicalCandleSchema = z.strictObject({
  instrumentId: z.string().min(1).max(128), timeframe: z.enum(TIMEFRAMES),
  openTime: timestampSchema, closeTime: timestampSchema,
  open: positiveDecimalSchema, high: positiveDecimalSchema, low: positiveDecimalSchema, close: positiveDecimalSchema, volume: decimalSchema,
});
export const historicalQuoteSchema = z.strictObject({
  instrumentId: z.string().min(1).max(128), eventId: z.string().min(1).max(128),
  time: timestampSchema, receivedAt: timestampSchema,
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  bid: decimalSchema, ask: positiveDecimalSchema,
  bidSize: decimalSchema, askSize: decimalSchema,
}).superRefine((v, ctx) => {
  if (dec.cmp(v.bid, v.ask) > 0) ctx.addIssue({ code: 'custom', path: ['bid'], message: 'Crossed quotes are not accepted.' });
  if (v.receivedAt < v.time) ctx.addIssue({ code: 'custom', path: ['receivedAt'], message: 'Receive time cannot precede exchange event time.' });
});
export const historicalTradeSchema = z.strictObject({
  instrumentId: z.string().min(1).max(128), eventId: z.string().min(1).max(128), time: timestampSchema, receivedAt: timestampSchema,
  price: positiveDecimalSchema, quantity: positiveDecimalSchema,
});
const signedDecimal = z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/);
export const marginSnapshotSchema = z.strictObject({
  source: z.string().min(1).max(500), time: timestampSchema, availableAt: timestampSchema,
  /** Full portfolio, in units. Historical short-option margin must come from a sourced model/snapshot. */
  positions: z.array(z.strictObject({ instrumentId: z.string().min(1), quantity: signedDecimal })).max(100),
  initial: decimalSchema, maintenance: decimalSchema,
}).superRefine((v, ctx) => {
  if (v.availableAt < v.time) ctx.addIssue({ code: 'custom', path: ['availableAt'], message: 'Margin snapshot cannot arrive before its event time.' });
  if (dec.cmp(v.maintenance, v.initial) > 0) ctx.addIssue({ code: 'custom', path: ['maintenance'], message: 'Maintenance margin cannot exceed initial margin.' });
  if (new Set(v.positions.map(p => p.instrumentId)).size !== v.positions.length) ctx.addIssue({ code: 'custom', path: ['positions'], message: 'Margin positions must be unique.' });
});
export const settlementSchema = z.strictObject({
  instrumentId: z.string().min(1), time: timestampSchema, underlyingPrice: positiveDecimalSchema, source: z.string().min(1).max(500),
});

export const marketDatasetSchema = z.strictObject({
  schemaVersion: z.literal(1), name: z.string().min(1).max(100),
  provenance: z.strictObject({
    source: z.string().min(1).max(500), license: z.string().min(1).max(500), importedAt: timestampSchema,
    adjustment: z.enum(['raw', 'split_adjusted', 'total_return']),
    adjustmentAsOf: timestampSchema.optional(),
  }),
  instruments: z.array(instrumentContractSchema).min(1).max(1000),
  /** Per exchange/segment schedules can differ; keyed by instrument id. */
  calendars: z.record(z.string(), sessionCalendarSchema).default({}),
  candles: z.array(historicalCandleSchema).max(500_000).default([]),
  quotes: z.array(historicalQuoteSchema).max(1_000_000).default([]),
  trades: z.array(historicalTradeSchema).max(1_000_000).default([]),
  corporateActions: z.array(corporateActionSchema).max(10_000).default([]),
  feeSchedules: z.array(feeScheduleSchema).max(1000).default([]),
  marginSnapshots: z.array(marginSnapshotSchema).max(100_000).default([]),
  settlements: z.array(settlementSchema).max(10_000).default([]),
}).superRefine((v, ctx) => {
  const known = new Map(v.instruments.map(i => [i.id, i]));
  if (known.size !== v.instruments.length) ctx.addIssue({ code: 'custom', path: ['instruments'], message: 'Instrument ids must be unique.' });
  const issues = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  for (const instrument of v.instruments) {
    if (instrument.assetClass !== 'crypto' && !v.calendars[instrument.id]) issues(['calendars', instrument.id], 'Non-crypto history requires an explicit exchange-session calendar.');
  }
  if (v.provenance.adjustment !== 'raw' && v.provenance.adjustmentAsOf === undefined) issues(['provenance', 'adjustmentAsOf'], 'Adjusted data requires an as-of timestamp.');
  const seen = new Set<string>();
  for (const [i, c] of v.candles.entries()) {
    const instrument = known.get(c.instrumentId);
    if (!instrument) { issues(['candles', i], 'Unknown instrument.'); continue; }
    const key = `${c.instrumentId}:${c.timeframe}:${c.openTime}`;
    if (seen.has(key)) issues(['candles', i], 'Duplicate candle.');
    seen.add(key);
    if (c.openTime < instrument.listedAt || (instrument.delistedAt !== undefined && c.closeTime >= instrument.delistedAt) || (instrument.option && c.closeTime >= instrument.option.expiry)) issues(['candles', i], 'Candle falls outside the historical instrument lifetime.');
    if (c.closeTime < c.openTime || dec.cmp(c.high, c.low) < 0 || dec.cmp(c.high, dec.max([c.open, c.close])) < 0 || dec.cmp(c.low, dec.min([c.open, c.close])) > 0) issues(['candles', i], 'Invalid OHLC bounds or candle interval.');
    if (instrument.assetClass === 'crypto' && !v.calendars[instrument.id] && (!isAligned(c.timeframe, c.openTime) || c.closeTime !== nextOpenTime(c.timeframe, c.openTime) - 1)) issues(['candles', i], 'Crypto candle is off its UTC timeframe grid.');
    if (v.provenance.adjustment === 'raw' && [c.open, c.high, c.low, c.close].some(price => !dec.isMultipleOf(price, instrument.tickSize))) issues(['candles', i], 'Raw prices must lie on the historical instrument tick grid.');
  }
  for (const kind of ['quotes', 'trades'] as const) {
    const events = new Set<string>();
    for (const [i, event] of v[kind].entries()) {
      const instrument = known.get(event.instrumentId);
      if (!instrument) { issues([kind, i], 'Unknown instrument.'); continue; }
      if (event.receivedAt < event.time) issues([kind, i], 'Receive time cannot precede exchange time.');
      const prices = 'price' in event ? [event.price] : [event.bid, event.ask];
      if (prices.some(price => !dec.isMultipleOf(price, instrument.tickSize))) issues([kind, i], 'Raw event prices must lie on the historical instrument tick grid.');
      if (event.time < instrument.listedAt || (instrument.delistedAt !== undefined && event.time >= instrument.delistedAt) || (instrument.option && event.time >= instrument.option.expiry)) issues([kind, i], 'Event falls outside the instrument lifetime.');
      const calendar = v.calendars[event.instrumentId];
      if (calendar && (event.time < calendar.coverageStart || event.time >= calendar.coverageEnd || !isTradingTime(calendar, event.time))) issues([kind, i], 'Event is outside the supplied instrument sessions.');
      const key = JSON.stringify([event.instrumentId, event.eventId]);
      if (events.has(key)) issues([kind, i], 'Duplicate provider event identity.');
      events.add(key);
    }
  }
  const actionIds = new Set<string>();
  for (const [i, action] of v.corporateActions.entries()) {
    if (!known.has(action.instrumentId) || actionIds.has(action.id)) issues(['corporateActions', i], 'Unknown instrument or duplicate action id.');
    if (action.declaredAt > action.effectiveAt || (action.type === 'DIVIDEND' && action.payableAt < action.effectiveAt)) issues(['corporateActions', i], 'Corporate-action chronology is invalid.');
    actionIds.add(action.id);
  }
  for (const [i, schedule] of v.feeSchedules.entries()) for (let j = 0; j < i; j++) {
    const other = v.feeSchedules[j]!;
    if (schedule.exchange === other.exchange && schedule.assetClass === other.assetClass && schedule.validFrom < other.validTo && other.validFrom < schedule.validTo) issues(['feeSchedules', i], 'Overlapping fee schedules are ambiguous.');
  }
  const settled = new Set<string>();
  for (const [i, settlement] of v.settlements.entries()) {
    const instrument = known.get(settlement.instrumentId);
    if (!instrument?.option || settlement.time < instrument.option.expiry || settled.has(settlement.instrumentId)) issues(['settlements', i], 'Settlement requires a unique option contract and a time at/after expiry.');
    settled.add(settlement.instrumentId);
  }
  for (const [i, snapshot] of v.marginSnapshots.entries()) if (snapshot.positions.some(p => !known.has(p.instrumentId))) issues(['marginSnapshots', i], 'Unknown margin instrument.');
  const candleGroups = new Map<string, Map<Timeframe, typeof v.candles>>();
  for (const c of v.candles) {
    let groups = candleGroups.get(c.instrumentId);
    if (!groups) { groups = new Map(); candleGroups.set(c.instrumentId, groups); }
    let group = groups.get(c.timeframe);
    if (!group) { group = []; groups.set(c.timeframe, group); }
    group.push(c);
  }
  for (const [id, calendar] of Object.entries(v.calendars)) {
    if (!known.has(id)) issues(['calendars', id], 'Unknown calendar instrument.');
    const groups = candleGroups.get(id) ?? new Map<Timeframe, typeof v.candles>();
    for (const [tf, candles] of groups) {
      try {
        if (candles.length && matchesIntradaySessionCandle(calendar, tf, candles[0]!) !== undefined) {
          if (candles.some(c => !matchesIntradaySessionCandle(calendar, tf, c))) issues(['candles'], `${id} has ${tf} candles off the supplied exchange session grid.`);
          continue;
        }
        let start = Number.MAX_SAFE_INTEGER, end = 0;
        for (const candle of candles) { start = Math.min(start, candle.openTime); end = Math.max(end, candle.closeTime + 1); }
        const expected = new Map(expectedSessionCandles(calendar, tf, start, end).map(c => [c.openTime, c.closeTime]));
        if (candles.some(c => expected.get(c.openTime) !== c.closeTime)) issues(['candles'], `${id} has ${tf} candles off the supplied exchange session grid.`);
      } catch (error) { issues(['calendars', id], error instanceof Error ? error.message : 'Invalid calendar.'); }
    }
  }
});

export type MarketDataset = z.infer<typeof marketDatasetSchema>;
export type HistoricalQuote = z.infer<typeof historicalQuoteSchema>;
export type MarginSnapshot = z.infer<typeof marginSnapshotSchema>;

/** Canonical content identity survives JSON property ordering and repeated equivalent imports. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function parseMarketDataset(input: unknown) {
  const dataset = marketDatasetSchema.parse(input);
  dataset.candles.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId) || a.timeframe.localeCompare(b.timeframe) || a.openTime - b.openTime);
  // Preserve supplied arrival order when timestamp resolution cannot order two distinct events.
  dataset.quotes.sort((a, b) => a.receivedAt - b.receivedAt || a.time - b.time || (a.sequence !== undefined && b.sequence !== undefined ? a.sequence - b.sequence : 0));
  dataset.trades.sort((a, b) => a.receivedAt - b.receivedAt || a.time - b.time);
  const checksum = createHash('sha256').update(canonicalJson(dataset)).digest('hex');
  return { dataset, checksum };
}

export function selectDatasetCandles(dataset: MarketDataset, instrumentId: string, timeframe: Timeframe, start: number, end: number) {
  if (!dataset.instruments.some(i => i.id === instrumentId)) throw new Error('Instrument is absent from this dataset.');
  return dataset.candles.filter(c => c.instrumentId === instrumentId && c.timeframe === timeframe && c.openTime >= start && c.closeTime < end)
    .map(({ instrumentId: _id, timeframe: _tf, ...c }) => c);
}
