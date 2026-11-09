import { describe, expect, test } from 'bun:test';
import { alignDown, alignUp, candlesBefore, DatasetError, definitionWarnings, expectedCandleCount, maxLookback, nextOpenTime, validateDataset } from '../../src/modules/backtesting/utils/validation';
import { strategyDefinitionSchema } from '../../src/modules/strategies/domain/definition';
import { definition, walk } from './fixtures';

const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z, a Thursday

const errorOf = (fn: () => unknown) => { try { fn(); } catch (e) { return e as DatasetError; } throw new Error('expected an error'); };

describe('UTC timeframe grid', () => {
  test('candles align to UTC boundaries, weeks to Monday and months to the 1st', () => {
    expect(alignUp('1h', T0 + 1)).toBe(T0 + H);
    expect(alignUp('1d', T0 + 5 * H)).toBe(T0 + D);
    expect(new Date(alignUp('1w', T0)).toISOString()).toBe('2026-01-05T00:00:00.000Z'); // Monday
    expect(new Date(nextOpenTime('1M', Date.UTC(2026, 1, 1))).toISOString()).toBe('2026-03-01T00:00:00.000Z'); // Feb has 28 days
    expect(expectedCandleCount('1h', T0, T0 + 24 * H)).toBe(24);
    expect(expectedCandleCount('1h', T0 + 1, T0 + 24 * H)).toBe(23); // a partial first hour is excluded
    expect(expectedCandleCount('1d', T0, T0 + 10 * D - 1)).toBe(9); // the 10th day has not closed
    expect(expectedCandleCount('1M', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1))).toBe(12);
    // "Last N closed candles" counts back from the candle containing now.
    const now = T0 + 5 * H + 1234;
    expect(expectedCandleCount('1h', candlesBefore('1h', alignDown('1h', now), 3), now)).toBe(3);
    expect(new Date(candlesBefore('1M', alignDown('1M', Date.UTC(2026, 2, 15)), 2)).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('dataset validation', () => {
  const candles = walk(300, { start: T0 });
  const range = { start: T0, end: T0 + 300 * H, now: T0 + 1000 * H };

  test('a complete dataset passes', () => {
    expect(validateDataset(candles, '1h', range)).toMatchObject({ expected: 300, missing: 0, droppedUnfinished: 0 });
  });

  test('unfinished candles are excluded, never backtested', () => {
    const live = { ...candles.at(-1)!, isClosed: false };
    const report = validateDataset([...candles.slice(0, -1), live], '1h', range);
    expect(report.candles.at(-1)!.openTime).toBe(candles.at(-2)!.openTime);
    expect(report.droppedUnfinished).toBe(1);
    // Also when the stored flag says closed but its close time is still in the future.
    const report2 = validateDataset(candles, '1h', { ...range, now: candles.at(-1)!.closeTime });
    expect(report2.candles).toHaveLength(299);
  });

  test('duplicate candles are rejected', () => {
    expect(errorOf(() => validateDataset([...candles, candles[10]!], '1h', range)).code).toBe('DUPLICATE_CANDLES');
  });

  test('candles of another timeframe are rejected', () => {
    expect(errorOf(() => validateDataset(walk(300, { start: T0, tf: '4h' }).slice(0, 200), '1h', range)).code).toBe('TIMEFRAME_MISMATCH');
    expect(errorOf(() => validateDataset([{ ...candles[0]!, openTime: candles[0]!.openTime + 60_000 }, ...candles.slice(1)], '1h', range)).code).toBe('TIMEFRAME_MISMATCH');
  });

  test('missing candles: small gaps are reported, large gaps rejected', () => {
    const small = validateDataset(candles.filter((_, i) => i !== 50 && i !== 51), '1h', range);
    expect(small).toMatchObject({ missing: 2, gaps: [{ from: candles[50]!.openTime, to: candles[52]!.openTime, missing: 2 }] });
    const large = errorOf(() => validateDataset(candles.filter((_, i) => i < 100 || i >= 120), '1h', range));
    expect(large.code).toBe('DATA_GAPS');
    expect(large.details).toMatchObject({ missing: 20, expected: 300 });
  });

  test('insufficient history is rejected with what is needed', () => {
    const e = errorOf(() => validateDataset(candles.slice(0, 80), '1h', { ...range, end: T0 + 80 * H }, 100));
    expect(e.code).toBe('INSUFFICIENT_DATA');
    expect(e.details).toMatchObject({ available: 80, required: 100 });
  });
});

describe('strategy checks', () => {
  test('lookback covers the longest indicator', () => {
    const def = strategyDefinitionSchema.parse(definition({ exit: { conditions: [{ left: { type: 'MACD', fast: 12, slow: 26, signal: 9, line: 'HISTOGRAM' }, operator: 'LT', right: { type: 'VALUE', value: 0 } }] } }));
    expect(maxLookback(def)).toBe(35);
  });
  test('impossible or self-defeating conditions are warned about, not rejected', () => {
    const def = strategyDefinitionSchema.parse(definition({
      entry: { conditions: [{ left: { type: 'RSI', period: 14 }, operator: 'GT', right: { type: 'VALUE', value: 150 } }, { left: { type: 'SMA', period: 5 }, operator: 'GT', right: { type: 'SMA', period: 5 } }] },
      exit: { conditions: [{ left: { type: 'SMA', period: 5 }, operator: 'GT', right: { type: 'SMA', period: 5 } }] },
    }));
    expect(definitionWarnings(def).map(w => w.code).sort()).toEqual(['ENTRY_EQUALS_EXIT', 'IMPOSSIBLE_CONDITION', 'NO_STOP_LOSS', 'SELF_COMPARISON', 'SELF_COMPARISON']);
  });
});
