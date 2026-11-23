import { z } from 'zod';
import type { MarketDataset, HistoricalQuote, MarginSnapshot } from '../datasets/import';
import { dec } from '../utils/decimal';
import { assertContractActive, decimalSchema, positiveDecimalSchema, timestampSchema, type InstrumentContract } from './contracts';
import { calculateExecutionCosts } from './costs';
import { isTradingTime } from './calendar';

const signedDecimal = z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/);
export const optionsExperimentSchema = z.strictObject({
  start: timestampSchema, end: timestampSchema, initialCapital: positiveDecimalSchema,
  orders: z.array(z.strictObject({
    id: z.string().min(1).max(128), time: timestampSchema,
    legs: z.array(z.strictObject({ instrumentId: z.string().min(1), side: z.enum(['BUY', 'SELL']), lots: z.number().int().min(1).max(1_000_000) })).min(1).max(20),
    timeInForce: z.enum(['FOK', 'IOC']).default('FOK'),
    /** Maximum net debit for the complete basket, excluding fees; negative means minimum credit. */
    limitNetDebit: signedDecimal.optional(),
  })).max(10_000),
  maxQuoteAgeMs: z.number().int().min(1).max(86_400_000).default(5000),
  maxMarginAgeMs: z.number().int().min(1).max(7 * 86_400_000).default(86_400_000),
  participationRate: positiveDecimalSchema.refine(v => dec.cmp(v, '1') <= 0).default('1'),
  latencyMs: z.number().int().min(0).max(60_000).default(0),
  slippageTicks: z.number().int().min(0).max(1000).default(0),
  initialHoldings: z.record(z.string(), positiveDecimalSchema).default({}),
}).superRefine((v, ctx) => {
  if (v.end <= v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'End must follow start.' });
  const ids = new Set<string>();
  for (const [i, order] of v.orders.entries()) {
    if (ids.has(order.id)) ctx.addIssue({ code: 'custom', path: ['orders', i, 'id'], message: 'Order ids must be unique.' });
    if (new Set(order.legs.map(l => l.instrumentId)).size !== order.legs.length) ctx.addIssue({ code: 'custom', path: ['orders', i], message: 'A basket cannot contain duplicate instruments.' });
    if (order.time < v.start || order.time + v.latencyMs >= v.end) ctx.addIssue({ code: 'custom', path: ['orders', i, 'time'], message: 'Orders including latency must lie within the run.' });
    ids.add(order.id);
  }
});
export type OptionsExperiment = z.infer<typeof optionsExperimentSchema>;
type Fill = { instrumentId: string; side: 'BUY' | 'SELL'; quantity: string; price: string; fee: string; feeComponents: Record<string, string>; quoteId: string };
type OrderResult = { id: string; time: number; status: 'FILLED' | 'PARTIAL' | 'REJECTED'; reason?: string; fills: Fill[]; fees: string; netDebit: string };
type Position = { quantity: string };
const signed = (quantity: string, side: 'BUY' | 'SELL') => side === 'BUY' ? quantity : dec.sub('0', quantity);
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const positionKey = (positions: Map<string, Position>) => JSON.stringify([...positions].filter(([, p]) => !dec.isZero(p.quantity)).sort(([a], [b]) => a.localeCompare(b)).map(([id, p]) => [id, dec.from(p.quantity)]));
const snapshotKey = (snapshot: MarginSnapshot) => positionKey(new Map(snapshot.positions.map(p => [p.instrumentId, { quantity: p.quantity }])));

/**
 * Historical order replay, not a predictive options strategy or exchange margin calculator.
 * Basket legs execute atomically against observed top-of-book sizes. IOC reduces whole basket
 * units; FOK refuses insufficient liquidity. No invented quote, future price or implicit margin.
 */
export function simulateOptionsPortfolio(dataset: MarketDataset, raw: unknown) {
  const request = optionsExperimentSchema.parse(raw);
  if (dataset.provenance.adjustment !== 'raw') throw new Error('Quote replay requires raw prices; adjusted prices are research-only.');
  const instruments = new Map(dataset.instruments.map(i => [i.id, i]));
  const usedIds = new Set([...request.orders.flatMap(o => o.legs.map(l => l.instrumentId)), ...Object.keys(request.initialHoldings)]);
  const currencies = new Set([...usedIds].map(id => { const instrument = instruments.get(id); if (!instrument) throw new Error(`Unknown instrument ${id}.`); return instrument.currency; }));
  if (currencies.size > 1) throw new Error('Cross-currency portfolios require explicit FX conversion and are not supported.');
  for (const id of usedIds) {
    const underlying = instruments.get(id)?.option?.underlyingId;
    if (underlying && instruments.has(underlying)) usedIds.add(underlying);
  }
  const positions = new Map<string, Position>(Object.entries(request.initialHoldings).map(([id, quantity]) => [id, { quantity }]));
  const latest = new Map<string, HistoricalQuote>();
  const consumed = new Map<string, string>();
  const dividends = new Map<string, string>();
  const settled = new Set<string>();
  const outcomes: OrderResult[] = [];
  const ledger: { time: number; kind: string; instrumentId?: string; amount: string; detail?: string }[] = [];
  const equityCurve: { time: number; equity: string; cash: string; margin: string }[] = [];
  const marginByPositions = new Map<string, MarginSnapshot[]>();
  for (const snapshot of dataset.marginSnapshots) {
    const key = snapshotKey(snapshot), list = marginByPositions.get(key) ?? [];
    list.push(snapshot); marginByPositions.set(key, list);
  }
  for (const list of marginByPositions.values()) list.sort((a, b) => a.availableAt - b.availableAt);
  let cash = request.initialCapital, totalFees = '0', initialEquity: string | undefined;

  function quote(id: string, time: number, strict = true) {
    const q = latest.get(id);
    if (!q || (strict && time - q.time > request.maxQuoteAgeMs)) throw new Error(`Missing or stale observable quote for ${id} at ${time}.`);
    return q;
  }
  function equity(p: Map<string, Position>, balance: string, time: number) {
    // Ex-date entitlement is an asset (or liability for a short), even before its cash pay date.
    let value = dec.add(balance, dec.sum([...dividends.values()]));
    for (const [id, position] of p) if (!dec.isZero(position.quantity)) {
      const instrument = instruments.get(id)!;
      const q = quote(id, time, !(instrument.option && time >= instrument.option.expiry));
      const mark = dec.isNegative(position.quantity) ? q.ask : q.bid;
      value = dec.add(value, dec.mul(dec.mul(position.quantity, mark), instrument.pointValue));
    }
    return value;
  }
  function margin(p: Map<string, Position>, time: number) {
    if (![...p.values()].some(v => dec.isNegative(v.quantity))) return { initial: '0', maintenance: '0' };
    const snapshots = marginByPositions.get(positionKey(p)) ?? [];
    const current = snapshots.filter(s => s.availableAt <= time && s.time <= time && time - s.time <= request.maxMarginAgeMs).at(-1);
    if (!current) throw new Error(`Missing historical margin for the complete short portfolio at ${time}.`);
    return current;
  }
  function fee(instrument: InstrumentContract, time: number, side: 'BUY' | 'SELL', price: string, quantity: string, event: 'TRADE' | 'EXERCISE' = 'TRADE', settlementUnderlying?: string) {
    const needsUnderlying = dataset.feeSchedules.some(s => s.exchange === instrument.exchange && s.assetClass === instrument.assetClass && s.validFrom <= time && time < s.validTo && s.components.some(c => c.basis === 'underlying_notional' && (c.side === 'BOTH' || c.side === side) && (c.event === 'BOTH' || c.event === event)));
    const underlyingPrice = settlementUnderlying ?? (needsUnderlying && instrument.option?.underlyingId ? quote(instrument.option.underlyingId, time).bid : undefined);
    return calculateExecutionCosts(dataset.feeSchedules, { instrument, time, side, price, quantity, underlyingPrice, event });
  }
  function execute(order: OptionsExperiment['orders'][number], time: number) {
    const reject = (reason: string) => outcomes.push({ id: order.id, time, status: 'REJECTED', reason, fills: [], fees: '0', netDebit: '0' });
    const basketUnits = order.legs.map(l => l.lots).reduce(gcd);
    let executableUnits = basketUnits;
    const planned = order.legs.map(leg => {
      const instrument = instruments.get(leg.instrumentId)!;
      assertContractActive(instrument, time);
      const calendar = dataset.calendars[instrument.id];
      if (calendar && !isTradingTime(calendar, time)) throw new Error(`Order ${order.id} is outside ${instrument.id}'s session.`);
      const q = quote(instrument.id, time);
      const key = JSON.stringify([instrument.id, q.eventId, leg.side]);
      const size = leg.side === 'BUY' ? q.askSize : q.bidSize;
      const available = dec.max(['0', dec.sub(dec.mul(size, request.participationRate), consumed.get(key) ?? '0')]);
      const perBasket = dec.mul(String(leg.lots / basketUnits), instrument.lotSize);
      executableUnits = Math.min(executableUnits, Number(dec.floorToStep(dec.div(available, perBasket), '1')));
      const slippage = dec.mul(String(request.slippageTicks), instrument.tickSize);
      const price = leg.side === 'BUY' ? dec.ceilToStep(dec.add(q.ask, slippage), instrument.tickSize) : dec.max(['0', dec.floorToStep(dec.sub(q.bid, slippage), instrument.tickSize)]);
      return { leg, instrument, q, key, perBasket, price };
    });
    if (executableUnits === 0 || (order.timeInForce === 'FOK' && executableUnits < basketUnits)) { reject('INSUFFICIENT_LIQUIDITY'); return; }
    const projected = new Map([...positions].map(([id, p]) => [id, { ...p }]));
    const fills: Fill[] = [];
    let netDebit = '0', fees = '0';
    for (const item of planned) {
      const quantity = dec.mul(item.perBasket, String(executableUnits));
      const costs = fee(item.instrument, time, item.leg.side, item.price, quantity);
      const turnover = dec.mul(dec.mul(item.price, quantity), item.instrument.pointValue);
      netDebit = dec.add(netDebit, signed(turnover, item.leg.side)); fees = dec.add(fees, costs.total);
      const current = projected.get(item.instrument.id)?.quantity ?? '0';
      projected.set(item.instrument.id, { quantity: dec.add(current, signed(quantity, item.leg.side)) });
      fills.push({ instrumentId: item.instrument.id, side: item.leg.side, quantity, price: item.price, fee: costs.total, feeComponents: costs.components, quoteId: item.q.eventId });
    }
    const limit = order.limitNetDebit === undefined ? undefined : dec.div(dec.mul(order.limitNetDebit, String(executableUnits)), String(basketUnits));
    if (limit !== undefined && dec.cmp(netDebit, limit) > 0) { reject('LIMIT_NOT_MET'); return; }
    const balance = dec.sub(cash, dec.add(netDebit, fees));
    const required = margin(projected, time);
    if (dec.cmp(balance, '0') < 0 || dec.cmp(equity(projected, balance, time), required.initial) < 0) { reject('INSUFFICIENT_FUNDS_OR_MARGIN'); return; }
    cash = balance; totalFees = dec.add(totalFees, fees);
    positions.clear(); for (const [id, p] of projected) positions.set(id, p);
    for (const [i, item] of planned.entries()) consumed.set(item.key, dec.add(consumed.get(item.key) ?? '0', fills[i]!.quantity));
    outcomes.push({ id: order.id, time, status: executableUnits === basketUnits ? 'FILLED' : 'PARTIAL', fills, fees, netDebit });
    ledger.push({ time, kind: 'TRADE', amount: dec.sub('0', dec.add(netDebit, fees)), detail: order.id });
  }

  type Event = { time: number; priority: number; run: () => void };
  const events: Event[] = [];
  for (const q of dataset.quotes) if (usedIds.has(q.instrumentId) && q.receivedAt < request.end) events.push({ time: q.receivedAt, priority: 1, run: () => {
    const previous = latest.get(q.instrumentId);
    if (!previous || q.time > previous.time || (q.time === previous.time && (q.sequence === undefined || previous.sequence === undefined || q.sequence >= previous.sequence))) latest.set(q.instrumentId, q);
  } });
  for (const action of dataset.corporateActions) if (usedIds.has(action.instrumentId) && action.effectiveAt >= request.start && action.effectiveAt < request.end) {
    events.push({ time: action.effectiveAt, priority: 0, run: () => {
      const position = positions.get(action.instrumentId);
      if (!position || dec.isZero(position.quantity)) return;
      if (action.type === 'SPLIT') {
        position.quantity = dec.mul(position.quantity, action.newUnitsPerOldUnit);
        latest.delete(action.instrumentId); // a pre-split quote may never value the new share count
        ledger.push({ time: action.effectiveAt, kind: 'SPLIT', instrumentId: action.instrumentId, amount: '0', detail: action.id });
      } else dividends.set(action.id, dec.mul(position.quantity, action.amountPerUnit));
    } });
    if (action.type === 'DIVIDEND' && action.payableAt < request.end) events.push({ time: action.payableAt, priority: 2, run: () => {
      const amount = dividends.get(action.id) ?? '0'; cash = dec.add(cash, amount); dividends.delete(action.id);
      ledger.push({ time: action.payableAt, kind: 'DIVIDEND', instrumentId: action.instrumentId, amount, detail: action.id });
    } });
  }
  for (const settlement of dataset.settlements) if (usedIds.has(settlement.instrumentId) && settlement.time >= request.start && settlement.time < request.end) events.push({ time: settlement.time, priority: 2, run: () => {
    const instrument = instruments.get(settlement.instrumentId)!, option = instrument.option!;
    const position = positions.get(instrument.id);
    settled.add(instrument.id);
    if (!position || dec.isZero(position.quantity)) return;
    const intrinsic = dec.max(['0', option.right === 'CALL' ? dec.sub(settlement.underlyingPrice, option.strike) : dec.sub(option.strike, settlement.underlyingPrice)]);
    const quantity = dec.abs(position.quantity), long = !dec.isNegative(position.quantity);
    let amount = '0';
    if (!dec.isZero(intrinsic)) {
      if (option.settlement === 'cash') amount = dec.mul(dec.mul(position.quantity, intrinsic), instrument.pointValue);
      else {
        const underlying = instruments.get(option.underlyingId);
        if (!underlying || underlying.assetClass !== 'equity') throw new Error('Physical delivery requires a supplied equity underlying contract.');
        const delivered = dec.mul(position.quantity, instrument.pointValue);
        const signedDelivery = option.right === 'CALL' ? delivered : dec.sub('0', delivered);
        const held = positions.get(underlying.id)?.quantity ?? '0';
        const resulting = dec.add(held, signedDelivery);
        amount = dec.sub('0', dec.mul(signedDelivery, option.strike));
        if (dec.isNegative(resulting) || dec.isNegative(dec.add(cash, amount))) throw new Error('Physical delivery has insufficient shares or funds; auction/financing costs must be modeled explicitly.');
        positions.set(underlying.id, { quantity: resulting });
        // Published official settlement is observable here, and supplies the delivery mark.
        latest.set(underlying.id, { instrumentId: underlying.id, eventId: `settlement:${instrument.id}`, time: settlement.time, receivedAt: settlement.time, bid: settlement.underlyingPrice, ask: settlement.underlyingPrice, bidSize: '0', askSize: '0' });
      }
      const costs = fee(instrument, settlement.time, long ? 'SELL' : 'BUY', intrinsic, quantity, 'EXERCISE', settlement.underlyingPrice);
      amount = dec.sub(amount, costs.total); totalFees = dec.add(totalFees, costs.total);
    }
    cash = dec.add(cash, amount); positions.delete(instrument.id);
    ledger.push({ time: settlement.time, kind: 'EXPIRY', instrumentId: instrument.id, amount });
  } });
  for (const order of request.orders) events.push({ time: order.time + request.latencyMs, priority: 3, run: () => execute(order, order.time + request.latencyMs) });
  events.push({ time: request.start, priority: 2.5, run: () => { initialEquity = equity(positions, cash, request.start); } });
  events.push({ time: request.end - 1, priority: 4, run: () => {} });
  events.sort((a, b) => a.time - b.time || a.priority - b.priority);
  let status: 'COMPLETED' | 'MARGIN_BREACH' = 'COMPLETED';
  for (let i = 0; i < events.length;) {
    const time = events[i]!.time;
    while (i < events.length && events[i]!.time === time) events[i++]!.run();
    if (time < request.start) continue;
    const value = equity(positions, cash, time), required = margin(positions, time);
    initialEquity ??= value;
    equityCurve.push({ time, equity: value, cash, margin: required.initial });
    if (dec.cmp(value, required.maintenance) < 0 || dec.isNegative(cash)) { status = 'MARGIN_BREACH'; break; }
  }
  if (status === 'COMPLETED') for (const [id, p] of positions) {
    const instrument = instruments.get(id)!;
    if (!dec.isZero(p.quantity) && instrument.option && instrument.option.expiry < request.end && !settled.has(id)) throw new Error(`Missing official expiry settlement for ${id}.`);
  }
  const finalEquity = equityCurve.at(-1)?.equity ?? request.initialCapital;
  let peak = initialEquity ?? request.initialCapital, maxDrawdown = '0';
  for (const point of equityCurve) { peak = dec.max([peak, point.equity]); maxDrawdown = dec.max([maxDrawdown, dec.sub(peak, point.equity)]); }
  return { status, initialEquity: initialEquity ?? request.initialCapital, finalEquity, cash, receivables: Object.fromEntries(dividends), netProfit: dec.sub(finalEquity, initialEquity ?? request.initialCapital), totalFees, maxDrawdown,
    positions: Object.fromEntries([...positions].filter(([, p]) => !dec.isZero(p.quantity))), orders: outcomes, ledger, equityCurve,
    assumptions: { execution: 'Observed top-of-book with configurable latency, slippage and size participation; basket legs are atomic simulation units.', margin: 'Supplied historical portfolio snapshots; a maintenance breach halts the simulation without inventing a liquidation fill.', settlement: 'Supplied official final settlement prices; physical settlement requires funded delivery.', valuation: 'Long positions marked at bid; short positions at ask. No order-book queue model or unobserved market impact.' } };
}
