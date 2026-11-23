import { describe, expect, test } from 'bun:test';
import { parseMarketDataset } from '../../src/modules/backtesting/datasets/import';
import { calendarWarmupStart, expectedSessionCandles, sessionCalendarSchema } from '../../src/modules/backtesting/market-models/calendar';
import { calculateExecutionCosts, feeScheduleSchema } from '../../src/modules/backtesting/market-models/costs';
import { adjustHistoricalCandles, applySplitToPosition } from '../../src/modules/backtesting/market-models/corporate-actions';
import { instrumentContractSchema } from '../../src/modules/backtesting/market-models/contracts';
import { simulateOptionsPortfolio } from '../../src/modules/backtesting/market-models/options';
import { buildWalkForwardWindows, compareParameterVariants, evaluateWalkForward } from '../../src/modules/backtesting/research/walk-forward';
import { computeRiskStatistics } from '../../src/modules/backtesting/research/risk-statistics';

const T = Date.UTC(2026, 0, 2, 3, 45), minute = 60_000;
const calendar = sessionCalendarSchema.parse({ timezone: 'Asia/Kolkata', source: 'test schedule, not an exchange calendar', version: '1', coverageStart: T - minute, coverageEnd: T + 60 * minute, sessions: [{ openTime: T - minute, closeTime: T + 60 * minute }] });
const instrument = (id: string, assetClass = 'index_option', option?: Record<string, unknown>) => ({ id, exchange: 'NSE', symbol: id, assetClass, currency: 'INR', tickSize: '0.05', lotSize: '1', pointValue: '1', listedAt: 0,
  ...(assetClass.endsWith('_option') && { option: { underlyingId: 'INDEX', right: 'CALL', strike: '100', expiry: T + 5000, settlement: 'cash', ...option } }) });
const q = (id: string, time: number, bid: string, ask: string, size = '100') => ({ instrumentId: id, eventId: `${id}:${time}`, time, receivedAt: time, bid, ask, bidSize: size, askSize: size });
const zeroFees = (assetClass = 'index_option') => ({ id: `zero:${assetClass}`, source: 'test-only zero fee fixture', exchange: 'NSE', assetClass, validFrom: 0, validTo: T + 100 * minute, components: [] });
const base = (overrides: Record<string, unknown> = {}) => parseMarketDataset({ schemaVersion: 1, name: 'Fixture', provenance: { source: 'synthetic test', license: 'test', importedAt: T, adjustment: 'raw' },
  instruments: [instrument('C')], calendars: { C: calendar }, quotes: [q('C', T, '9', '10'), q('C', T + 1000, '12', '13')], feeSchedules: [zeroFees()], ...overrides }).dataset;
const order = (id: string, time: number, side: 'BUY' | 'SELL', lots = 1) => ({ id, time, legs: [{ instrumentId: 'C', side, lots }] });
const candle = (i: number) => ({ openTime: T + i * minute, closeTime: T + (i + 1) * minute - 1, open: '100', high: '110', low: '90', close: '100', volume: '10' });

describe('explicit historical sessions and imports', () => {
  test('session bars anchor at exchange open, include short final bar, and skip closed days', () => {
    const c = sessionCalendarSchema.parse({ ...calendar, coverageEnd: T + 4 * 86_400_000,
      sessions: [{ openTime: T, closeTime: T + 75 * minute }, { openTime: T + 3 * 86_400_000, closeTime: T + 3 * 86_400_000 + 75 * minute }] });
    const bars = expectedSessionCandles(c, '1h', c.coverageStart, c.coverageEnd);
    expect(bars).toHaveLength(4);
    expect(bars[1]).toEqual({ openTime: T + 60 * minute, closeTime: T + 75 * minute - 1 });
    expect(calendarWarmupStart(c, '1h', T + 3 * 86_400_000, 2)).toBe(T);
    expect(() => expectedSessionCandles(c, '1h', T - 2 * minute, c.coverageEnd)).toThrow('coverage');
  });
  test('rejects missing calendars, duplicate events, invalid prices and incomplete contracts', () => {
    expect(() => base({ calendars: {} })).toThrow();
    expect(() => base({ quotes: [q('C', T, '9', '10'), q('C', T, '9', '10')] })).toThrow('Duplicate');
    expect(() => base({ quotes: [q('C', T, '9.001', '10')] })).toThrow('tick grid');
    expect(() => base({ instruments: [{ ...instrument('C'), option: undefined }] })).toThrow();
    expect(() => base({ instruments: [instrument('toString')], calendars: {} })).toThrow('reserved');
    expect(() => base({ quotes: [{ ...q('C', T, '9', '10'), receivedAt: T - 1 }] })).toThrow();
  });
  test('partial calendar coverage cannot manufacture a completed weekly or monthly bar', () => {
    expect(expectedSessionCandles(calendar, '1w', calendar.coverageStart, calendar.coverageEnd)).toEqual([]);
    expect(expectedSessionCandles(calendar, '1M', calendar.coverageStart, calendar.coverageEnd)).toEqual([]);
  });
  test('sparse long calendar imports and warm-up do not expand millions of missing minute bars', () => {
    const end = T + 10 * 365 * 86_400_000;
    const c = sessionCalendarSchema.parse({ ...calendar, coverageEnd: end, sessions: [{ openTime: T, closeTime: end }] });
    const data = base({ instruments: [instrument('E', 'equity')], calendars: { E: c }, quotes: [], candles: [{ instrumentId: 'E', timeframe: '1m', ...candle(0) }, { instrumentId: 'E', timeframe: '1m', ...candle(10 * 365 * 24 * 60 - 1) }] });
    expect(data.candles).toHaveLength(2);
    expect(calendarWarmupStart(c, '1m', end, 50)).toBe(end - 50 * minute);
  });
  test('crypto imports validate interval grid without requiring exchange sessions', () => {
    const crypto = instrument('BTC', 'crypto');
    expect(() => base({ instruments: [crypto], calendars: {}, quotes: [], candles: [{ instrumentId: 'BTC', timeframe: '1m', ...candle(0), openTime: T + 1 }] })).toThrow('UTC timeframe');
  });
  test('canonical checksums do not depend on object key insertion order', () => {
    const dataset = base();
    const a = parseMarketDataset(dataset).checksum;
    const b = parseMarketDataset(Object.fromEntries(Object.entries(dataset).reverse())).checksum;
    expect(a).toBe(b);
  });
});

describe('historical costs and corporate actions', () => {
  test('effective fees apply sides, caps and tax-on-selected-fees with exact decimals', () => {
    const schedule = feeScheduleSchema.parse({ ...zeroFees(), components: [
      { name: 'brokerage', basis: 'turnover', ratePercent: '0.1', maximum: '20' },
      { name: 'sell-tax', basis: 'turnover', side: 'SELL', ratePercent: '0.2' },
      { name: 'tax-on-brokerage', basis: 'fees', feeNames: ['brokerage'], ratePercent: '18' },
    ] });
    const costs = calculateExecutionCosts([schedule], { instrument: instrumentContractSchema.parse(instrument('C')), time: T, side: 'SELL', price: '100', quantity: '1000' });
    expect(costs.components).toEqual({ brokerage: '20', 'sell-tax': '200', 'tax-on-brokerage': '3.6' });
    expect(costs.total).toBe('223.6');
    expect(() => calculateExecutionCosts([schedule, schedule], { instrument: instrumentContractSchema.parse(instrument('C')), time: T, side: 'BUY', price: '1', quantity: '1' })).toThrow('Exactly one');
  });
  test('split adjustments are explicit, preserve turnover, and exclude unknown future actions', () => {
    const split = { id: 's', instrumentId: 'E', source: 'test', declaredAt: T, effectiveAt: T + 2 * minute, type: 'SPLIT' as const, newUnitsPerOldUnit: '2' };
    const adjusted = adjustHistoricalCandles([candle(0), candle(1), candle(2)], [split], { instrumentId: 'E', asOf: T + 2 * minute, mode: 'split_adjusted' });
    expect(adjusted.candles[0]!.open).toBe('50'); expect(adjusted.candles[0]!.volume).toBe('20'); expect(adjusted.candles[2]!.open).toBe('100');
    expect(adjustHistoricalCandles([candle(0)], [split], { instrumentId: 'E', asOf: T + minute, mode: 'split_adjusted' }).candles[0]!.open).toBe('100');
    expect(applySplitToPosition({ quantity: '10', averagePrice: '100' }, split)).toEqual({ quantity: '20', averagePrice: '50' });
  });
  test('user-provided fee names cannot erase fees through prototype dictionary keys', () => {
    const schedule = feeScheduleSchema.parse({ ...zeroFees(), components: [{ name: '__proto__', basis: 'turnover', flat: '5' }] });
    const costs = calculateExecutionCosts([schedule], { instrument: instrumentContractSchema.parse(instrument('C')), time: T, side: 'BUY', price: '10', quantity: '1' });
    expect(costs.total).toBe('5'); expect(costs.components['__proto__']).toBe('5');
  });
});

describe('historical quote and multi-leg execution', () => {
  test('buys at ask, sells at bid and keeps initial equity before the entry spread', () => {
    const result = simulateOptionsPortfolio(base(), { start: T, end: T + 2000, initialCapital: '100', orders: [order('buy', T, 'BUY'), order('sell', T + 1000, 'SELL')] });
    expect(result.orders.map(o => o.fills[0]!.price)).toEqual(['10', '12']);
    expect(result.initialEquity).toBe('100'); expect(result.finalEquity).toBe('102'); expect(result.netProfit).toBe('2');
  });
  test('receive-time gating prevents execution against an unobserved future quote', () => {
    const dataset = base({ quotes: [{ ...q('C', T, '9', '10'), receivedAt: T + 1000 }] });
    expect(() => simulateOptionsPortfolio(dataset, { start: T, end: T + 2000, initialCapital: '100', orders: [order('buy', T, 'BUY')] })).toThrow('Missing or stale');
  });
  test('a delayed older sequence cannot replace a newer quote at the same exchange timestamp', () => {
    const dataset = base({ quotes: [{ ...q('C', T, '9', '10'), eventId: 'new', sequence: 2 }, { ...q('C', T, '90', '100'), eventId: 'old', sequence: 1, receivedAt: T + 1 }] });
    const result = simulateOptionsPortfolio(dataset, { start: T, end: T + 1000, initialCapital: '100', orders: [order('buy', T + 1, 'BUY')] });
    expect(result.orders[0]!.fills[0]!.price).toBe('10');
  });
  test('FOK refuses limited size; IOC fills whole lots and repeated orders cannot reuse size', () => {
    const dataset = base({ quotes: [q('C', T, '9', '10', '2')] });
    const result = simulateOptionsPortfolio(dataset, { start: T, end: T + 1000, initialCapital: '100', orders: [order('fok', T, 'BUY', 3), { ...order('ioc', T, 'BUY', 3), timeInForce: 'IOC' }, order('again', T, 'BUY')] });
    expect(result.orders.map(o => o.status)).toEqual(['REJECTED', 'PARTIAL', 'REJECTED']);
    expect(result.orders[1]!.fills[0]!.quantity).toBe('2');
  });
  test('shorts require portfolio-specific historical margin', () => {
    expect(() => simulateOptionsPortfolio(base(), { start: T, end: T + 2000, initialCapital: '100', orders: [order('sell', T, 'SELL')] })).toThrow('historical margin');
  });
  test('instrument ids containing delimiters cannot collide with a different margin portfolio', () => {
    const dataset = base({ instruments: [instrument('A'), instrument('B'), instrument('A:-1|B')], calendars: { A: calendar, B: calendar, 'A:-1|B': calendar },
      quotes: [q('A', T, '9', '10'), q('B', T, '9', '10')],
      marginSnapshots: [{ source: 'wrong portfolio', time: T, availableAt: T, positions: [{ instrumentId: 'A:-1|B', quantity: '-1' }], initial: '1', maintenance: '1' }],
    });
    expect(() => simulateOptionsPortfolio(dataset, { start: T, end: T + 1000, initialCapital: '100', orders: [{ id: 'short', time: T, legs: [{ instrumentId: 'A', side: 'SELL', lots: 1 }, { instrumentId: 'B', side: 'SELL', lots: 1 }] }] })).toThrow('historical margin');
  });
  test('cash-settled call spread uses shared capital and historical margin', () => {
    const dataset = base({ instruments: [instrument('C'), instrument('C2', 'index_option', { strike: '110' })], calendars: { C: calendar, C2: calendar },
      quotes: [q('C', T, '9', '10'), q('C2', T, '3', '4')],
      marginSnapshots: [{ source: 'test margin', time: T, availableAt: T, positions: [{ instrumentId: 'C', quantity: '1' }, { instrumentId: 'C2', quantity: '-1' }], initial: '10', maintenance: '5' }],
      settlements: [{ instrumentId: 'C', time: T + 5000, underlyingPrice: '115', source: 'test settlement' }, { instrumentId: 'C2', time: T + 5000, underlyingPrice: '115', source: 'test settlement' }],
    });
    const result = simulateOptionsPortfolio(dataset, { start: T, end: T + 6000, initialCapital: '100', orders: [{ id: 'spread', time: T, legs: [{ instrumentId: 'C', side: 'BUY', lots: 1 }, { instrumentId: 'C2', side: 'SELL', lots: 1 }] }] });
    expect(result.finalEquity).toBe('103'); expect(result.positions).toEqual({}); expect(result.ledger.filter(e => e.kind === 'EXPIRY')).toHaveLength(2);
  });
  test('missing expiry settlement prevents a falsely completed options result', () => {
    expect(() => simulateOptionsPortfolio(base({ quotes: [q('C', T, '9', '10')] }), { start: T, end: T + 6000, initialCapital: '100', orders: [order('buy', T, 'BUY')] })).toThrow('Missing official expiry');
  });
  test('physical exercise delivers funded shares and books strike payment', () => {
    const dataset = base({ instruments: [instrument('C', 'stock_option', { underlyingId: 'E', settlement: 'physical' }), instrument('E', 'equity')], calendars: { C: calendar, E: calendar },
      quotes: [q('C', T, '9', '10'), q('E', T, '100', '101')], feeSchedules: [zeroFees('stock_option'), zeroFees('equity')],
      settlements: [{ instrumentId: 'C', time: T + 5000, underlyingPrice: '115', source: 'test settlement' }],
    });
    const result = simulateOptionsPortfolio(dataset, { start: T, end: T + 6000, initialCapital: '200', orders: [order('buy', T, 'BUY')] });
    expect(result.cash).toBe('90'); expect(result.positions).toEqual({ E: { quantity: '1' } }); expect(result.finalEquity).toBe('205');
  });
  test('equity splits and dividend receivables preserve value across ex-date and payment', () => {
    const dataset = base({ instruments: [instrument('E', 'equity')], calendars: { E: calendar }, feeSchedules: [zeroFees('equity')],
      quotes: [q('E', T, '100', '100'), q('E', T + 1000, '50', '50'), q('E', T + 2000, '45', '45')],
      corporateActions: [
        { id: 'split', instrumentId: 'E', source: 'test', declaredAt: T, effectiveAt: T + 1000, type: 'SPLIT', newUnitsPerOldUnit: '2' },
        { id: 'dividend', instrumentId: 'E', source: 'test', declaredAt: T, effectiveAt: T + 2000, payableAt: T + 3000, type: 'DIVIDEND', amountPerUnit: '5' },
      ],
    });
    const result = simulateOptionsPortfolio(dataset, { start: T, end: T + 4000, initialCapital: '100', initialHoldings: { E: '1' }, orders: [] });
    expect(result.positions).toEqual({ E: { quantity: '2' } }); expect(result.cash).toBe('110');
    expect(result.equityCurve.every(p => p.equity === '200')).toBe(true); expect(result.netProfit).toBe('0');
  });
});

describe('research validation', () => {
  test('rejects overlapping tests and uses embargo-separated windows', () => {
    expect(() => buildWalkForwardWindows(100, { trainBars: 20, testBars: 10, stepBars: 5 })).toThrow('Overlapping');
    const windows = buildWalkForwardWindows(50, { trainBars: 20, testBars: 10, embargoBars: 5 });
    expect(windows).toEqual([{ id: 0, trainStart: 0, trainEnd: 20, testStart: 25, testEnd: 35 }, { id: 1, trainStart: 10, trainEnd: 30, testStart: 35, testEnd: 45 }]);
  });
  test('parameter selection never sees the future test candles', async () => {
    const seen: { phase: string; last: number }[] = [];
    const result = await evaluateWalkForward({ candles: Array.from({ length: 50 }, (_, i) => candle(i)), config: { trainBars: 20, testBars: 10, embargoBars: 5 }, candidates: [1, 2], warmupBars: 5,
      evaluate: async ({ phase, candles, parameters, warmup }) => {
        seen.push({ phase, last: candles.at(-1)!.openTime });
        if (warmup.length) expect(warmup.at(-1)!.closeTime).toBeLessThan(candles[0]!.openTime);
        return { score: phase === 'TRAIN' ? parameters : -parameters, metrics: {} };
      },
    });
    expect(result.windows.map(w => w.selectedCandidate)).toEqual([1, 1]);
    expect(seen[0]!.last).toBe(T + 19 * minute); expect(seen[2]!.phase).toBe('TEST'); expect(seen[2]!.last).toBe(T + 34 * minute);
  });
  test('sensitivity exposes all variants and ratios handle flat/insufficient equity', async () => {
    const result = await compareParameterVariants({ candles: [candle(0)], candidates: [2, 1, 3], evaluate: async ({ parameters }) => ({ score: parameters, metrics: {} }) });
    expect(result.medianScore).toBe(2); expect(result.results).toHaveLength(3);
    const stats = computeRiskStatistics({ equity: [0, 1, 2].map(i => ({ time: T + i * minute, equity: '100' })), periodsPerYear: 252 });
    expect(stats.sharpe).toBeNull(); expect(stats.sortino).toBeNull(); expect(stats.cagrPercent).toBe('0');
  });
});
