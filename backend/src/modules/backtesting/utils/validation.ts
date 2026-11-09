// Dataset and strategy checks. Pure functions; all timestamps are Unix ms in UTC.
import type { Timeframe } from '../../market/domain/market-options';
import type { Condition, StrategyDefinition } from '../../strategies/domain/definition';
import { LIMITS } from '../backtesting.constants';
import type { BacktestWarning, DatasetCandle } from '../backtesting.types';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR, WEEK = 7 * DAY;
const FIXED: Record<Exclude<Timeframe, '1M'>, number> = { '1m': MINUTE, '5m': 5 * MINUTE, '15m': 15 * MINUTE, '30m': 30 * MINUTE, '1h': HOUR, '4h': 4 * HOUR, '1d': DAY, '1w': WEEK };
/** Binance weeks open on Monday 00:00 UTC; the Unix epoch was a Thursday. */
const WEEK_OFFSET = 4 * DAY;

/** Open time of the first candle at or after `t`. */
export function alignUp(tf: Timeframe, t: number): number {
  if (tf === '1M') {
    const d = new Date(t);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return start === t ? t : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const step = FIXED[tf], offset = tf === '1w' ? WEEK_OFFSET : 0;
  return Math.ceil((t - offset) / step) * step + offset;
}

/** Open time of the candle containing `t`. */
export function alignDown(tf: Timeframe, t: number): number {
  if (tf === '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  const step = FIXED[tf], offset = tf === '1w' ? WEEK_OFFSET : 0;
  return Math.floor((t - offset) / step) * step + offset;
}

/** Open time of the candle `n` candles before the one opening at `openTime`. */
export function candlesBefore(tf: Timeframe, openTime: number, n: number): number {
  if (tf === '1M') {
    const d = new Date(openTime);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1);
  }
  return openTime - n * FIXED[tf];
}

export const isAligned = (tf: Timeframe, t: number) => alignUp(tf, t) === t;

export function nextOpenTime(tf: Timeframe, openTime: number): number {
  if (tf === '1M') {
    const d = new Date(openTime);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return openTime + FIXED[tf];
}

/** Opens in [start, end) whose candle has fully closed by `end`. */
export function expectedCandleCount(tf: Timeframe, start: number, end: number): number {
  let n = 0;
  for (let t = alignUp(tf, start); nextOpenTime(tf, t) <= end; t = nextOpenTime(tf, t)) {
    n++;
    if (n > LIMITS.maxCandles * 10) break; // guard against absurd ranges
  }
  return n;
}

/** Approximate duration, for converting a candle count into a time span. */
export const timeframeMs = (tf: Timeframe) => (tf === '1M' ? 30 * DAY : FIXED[tf]);

export type DatasetErrorCode = 'INSUFFICIENT_DATA' | 'DATA_GAPS' | 'DUPLICATE_CANDLES' | 'TIMEFRAME_MISMATCH';
export class DatasetError extends Error {
  constructor(readonly code: DatasetErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DatasetError';
  }
}

export type DatasetReport = { candles: DatasetCandle[]; expected: number; missing: number; droppedUnfinished: number; gaps: { from: number; to: number; missing: number }[] };

/**
 * Validates candles loaded for [start, end): drops any candle not closed by `now`, rejects
 * duplicates and candles off the timeframe grid, measures gaps and enforces minimum history.
 */
export function validateDataset(
  input: (DatasetCandle & { isClosed?: boolean })[],
  tf: Timeframe,
  range: { start: number; end: number; now: number },
  minCandles: number = LIMITS.minCandles,
): DatasetReport {
  const finished = input.filter(c => c.isClosed !== false && c.closeTime < range.now && c.closeTime < range.end && c.openTime >= range.start);
  const droppedUnfinished = input.filter(c => (c.isClosed === false || c.closeTime >= range.now) && c.openTime >= range.start && c.openTime < range.end).length;
  const candles = [...finished].sort((a, b) => a.openTime - b.openTime);

  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.openTime === candles[i - 1]!.openTime) {
      throw new DatasetError('DUPLICATE_CANDLES', 'The stored history contains duplicate candles.', { openTime: candles[i]!.openTime });
    }
  }
  for (const c of candles) {
    if (!isAligned(tf, c.openTime) || c.closeTime !== nextOpenTime(tf, c.openTime) - 1) {
      throw new DatasetError('TIMEFRAME_MISMATCH', `Stored candles do not match the ${tf} timeframe.`, { openTime: c.openTime, closeTime: c.closeTime });
    }
  }

  const expected = expectedCandleCount(tf, range.start, Math.min(range.end, range.now));
  const gaps: DatasetReport['gaps'] = [];
  let missing = 0;
  let cursor = alignUp(tf, range.start);
  for (const c of candles) {
    if (c.openTime > cursor) {
      let n = 0;
      for (let t = cursor; t < c.openTime; t = nextOpenTime(tf, t)) n++;
      missing += n;
      if (gaps.length < 20) gaps.push({ from: cursor, to: c.openTime, missing: n });
    }
    cursor = nextOpenTime(tf, c.openTime);
  }
  const tail = expected - candles.length - missing;
  if (tail > 0) { missing += tail; if (gaps.length < 20) gaps.push({ from: cursor, to: Math.min(range.end, range.now), missing: tail }); }

  if (candles.length < minCandles) {
    throw new DatasetError('INSUFFICIENT_DATA', `Only ${candles.length} closed candles are available; at least ${minCandles} are needed.`, { available: candles.length, required: minCandles, expected });
  }
  if (expected > 0 && missing / expected > LIMITS.maxMissingRatio) {
    throw new DatasetError('DATA_GAPS', `${missing} of ${expected} candles are missing from the requested range.`, { missing, expected, gaps });
  }
  return { candles, expected, missing, droppedUnfinished, gaps };
}

// ---- Strategy definition checks ---------------------------------------------------------------

type Operand = Condition['left'] | Condition['right'];

/** Longest indicator lookback, so the dataset includes enough warm-up history. */
export function maxLookback(def: StrategyDefinition): number {
  const of = (o: Operand): number => {
    switch (o.type) {
      case 'SMA': case 'EMA': case 'RSI': case 'BOLLINGER': return o.period;
      case 'MACD': return o.slow + o.signal;
      default: return 0;
    }
  };
  return Math.max(0, ...[...def.entry.conditions, ...def.exit.conditions].flatMap(c => [of(c.left), of(c.right)]));
}

export const requiredCandles = (def: StrategyDefinition) => Math.max(LIMITS.minCandles, maxLookback(def) + LIMITS.warmupMargin);

/** Static problems that make a definition never (or always) trade. Warnings, never rejections. */
export function definitionWarnings(def: StrategyDefinition): BacktestWarning[] {
  const warnings: BacktestWarning[] = [];
  const key = (o: Operand) => JSON.stringify(o);
  const describe = (c: Condition) => `${key(c.left)} ${c.operator} ${key(c.right)}`;
  for (const c of [...def.entry.conditions, ...def.exit.conditions]) {
    if (key(c.left) === key(c.right)) warnings.push({ code: 'SELF_COMPARISON', message: `A condition compares an indicator with itself and can never change: ${describe(c)}` });
    // VALUE can only appear on the right-hand side.
    if (c.left.type === 'RSI' && c.right.type === 'VALUE' && (c.right.value <= 0 || c.right.value >= 100)) {
      warnings.push({ code: 'IMPOSSIBLE_CONDITION', message: `RSI is always between 0 and 100, so comparing it with ${c.right.value} is always or never true.` });
    }
  }
  const exitKeys = new Set(def.exit.conditions.map(describe));
  if (def.entry.conditions.some(c => exitKeys.has(describe(c)))) {
    warnings.push({ code: 'ENTRY_EQUALS_EXIT', message: 'An entry condition is also an exit condition, so positions may close as soon as they open.' });
  }
  if (def.exit.stopLossPercent === undefined) warnings.push({ code: 'NO_STOP_LOSS', message: 'The strategy has no stop loss.' });
  return warnings;
}
