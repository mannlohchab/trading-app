// Market rules. Pure functions: no framework, database or I/O.
import { isTimeframe } from './market-options';
import type { Candle, Decimal, Topic } from './types';

export const LIMITS = {
  candlesDefault: 300,
  candlesMax: 1000,
  tickersPerRequest: 100,
  tickerListMax: 500,
  symbolsPageMax: 500,
  topicsPerConnection: 50,
} as const;

const SYMBOL = /^[A-Z0-9]{2,30}$/;
const EXCHANGE = /^[A-Z0-9_]{2,30}$/;

/** Upper-cases and validates an exchange symbol such as "btcusdt". */
export function normalizeSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase();
  return SYMBOL.test(symbol) ? symbol : null;
}
export function normalizeExchange(value: string): string | null {
  const code = value.trim().toUpperCase();
  return EXCHANGE.test(code) ? code : null;
}

/** "ticker:BINANCE:BTCUSDT" or "candles:BINANCE:BTCUSDT:1m". */
export function parseTopic(value: string): Topic | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const [kind, rawExchange, rawSymbol, timeframe, ...rest] = value.split(':');
  const exchange = rawExchange && normalizeExchange(rawExchange);
  const symbol = rawSymbol && normalizeSymbol(rawSymbol);
  if (!exchange || !symbol || rest.length) return null;
  if (kind === 'ticker' && timeframe === undefined) return { kind, exchange, symbol };
  if (kind === 'candles' && timeframe && isTimeframe(timeframe)) return { kind, exchange, symbol, timeframe };
  return null;
}

export const topicKey = (t: Topic) =>
  t.kind === 'ticker' ? `ticker:${t.exchange}:${t.symbol}` : `candles:${t.exchange}:${t.symbol}:${t.timeframe}`;

/** Strips insignificant zeros so live and stored values look the same ("73886.01000000" → "73886.01"). */
export function normalizeDecimal(value: string): Decimal {
  const v = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`Not a decimal: ${value}`);
  if (!v.includes('.')) return v.replace(/^(-?)0+(?=\d)/, '$1');
  const out = v.replace(/0+$/, '').replace(/\.$/, '').replace(/^(-?)0+(?=\d)/, '$1');
  return out === '-0' ? '0' : out;
}

/** Number of decimal places in a step such as "0.00100000" (→ 3). */
export function decimalPlaces(step: string): number {
  const n = normalizeDecimal(step);
  const dot = n.indexOf('.');
  return dot === -1 ? 0 : n.length - dot - 1;
}

/** Same rules as the market_candles CHECK constraints, so bad provider data never reaches the database. */
export function isValidCandle(c: Candle): boolean {
  const [o, h, l, cl, v] = [c.open, c.high, c.low, c.close, c.volume].map(Number) as [number, number, number, number, number];
  return (
    Number.isFinite(o + h + l + cl + v) &&
    c.closeTime >= c.openTime &&
    h >= l && h >= o && h >= cl && l <= o && l <= cl &&
    v >= 0 && (c.quoteVolume === null || Number(c.quoteVolume) >= 0)
  );
}

export const clampCandleLimit = (limit: number | undefined) =>
  Math.min(LIMITS.candlesMax, Math.max(1, Math.floor(limit ?? LIMITS.candlesDefault)));
