// Technical indicators and a compact market summary. Pure functions over closed candles.
// Indicators are approximations for analysis, so floating point is fine here (never for balances).
import type { Candle } from './types';

export const sma = (values: number[], period: number): number | null =>
  values.length < period ? null : values.slice(-period).reduce((a, b) => a + b, 0) / period;

export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (const v of values.slice(period)) out.push((prev = v * k + prev * (1 - k)));
  return out;
}
export const ema = (values: number[], period: number) => emaSeries(values, period).at(-1) ?? null;

/** Wilder's RSI. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = emaSeries(closes, fast), s = emaSeries(closes, slow);
  if (!s.length) return null;
  const line = s.map((v, i) => f[i + (slow - fast)]! - v);
  const sig = emaSeries(line, signal);
  if (!sig.length) return null;
  const m = line.at(-1)!, sg = sig.at(-1)!;
  return { macd: m, signal: sg, histogram: m - sg };
}

export function bollinger(closes: number[], period = 20, stdDev = 2) {
  const mid = sma(closes, period);
  if (mid === null) return null;
  const window = closes.slice(-period);
  const sd = Math.sqrt(window.reduce((a, v) => a + (v - mid) ** 2, 0) / period);
  return { upper: mid + stdDev * sd, middle: mid, lower: mid - stdDev * sd };
}

/** Average true range (simple average of the last `period` true ranges). */
export function atr(candles: { high: number; low: number; close: number }[], period = 14): number | null {
  if (candles.length <= period) return null;
  const tr = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i]!.close), Math.abs(c.low - candles[i]!.close)));
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

const round = (v: number | null, digits = 4) => (v === null || !Number.isFinite(v) ? null : Number(v.toPrecision(digits + 4)));
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export type MarketSummary = {
  candles: number;
  from: number;
  to: number;
  lastClose: number;
  changePercent: number | null;
  high: number;
  low: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS' | 'UNKNOWN';
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  rsiState: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bollinger: { upper: number; middle: number; lower: number; positionPercent: number | null } | null;
  atr14Percent: number | null;
  volumeVsAverage: number | null;
  support: number;
  resistance: number;
};

/** Summarizes closed candles (oldest first). Returns null with fewer than 2 candles. */
export function summarizeMarket(input: Candle[]): MarketSummary | null {
  const candles = input.filter(c => c.isClosed);
  if (candles.length < 2) return null;
  const k = candles.map(c => ({ open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) }));
  const closes = k.map(c => c.close);
  const last = closes.at(-1)!;
  const s20 = sma(closes, 20), s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const bb = bollinger(closes, 20, 2);
  const a = atr(k, 14);
  const recent = k.slice(-30);
  const avgVol = sma(k.slice(0, -1).map(c => c.volume), Math.min(20, k.length - 1));
  const trend = s20 === null || s50 === null ? 'UNKNOWN'
    : last > s20 && s20 > s50 ? 'UP'
    : last < s20 && s20 < s50 ? 'DOWN'
    : 'SIDEWAYS';
  const m = macd(closes);
  return {
    candles: candles.length,
    from: candles[0]!.openTime,
    to: candles.at(-1)!.closeTime,
    lastClose: last,
    changePercent: pct(((last - closes[0]!) / closes[0]!) * 100),
    high: Math.max(...k.map(c => c.high)),
    low: Math.min(...k.map(c => c.low)),
    trend,
    sma20: round(s20), sma50: round(s50), ema20: round(ema(closes, 20)),
    rsi14: pct(r),
    rsiState: r === null ? null : r >= 70 ? 'OVERBOUGHT' : r <= 30 ? 'OVERSOLD' : 'NEUTRAL',
    macd: m && { macd: round(m.macd)!, signal: round(m.signal)!, histogram: round(m.histogram)! },
    bollinger: bb && {
      upper: round(bb.upper)!, middle: round(bb.middle)!, lower: round(bb.lower)!,
      positionPercent: bb.upper === bb.lower ? null : pct(((last - bb.lower) / (bb.upper - bb.lower)) * 100),
    },
    atr14Percent: a === null ? null : pct((a / last) * 100),
    volumeVsAverage: avgVol ? pct(k.at(-1)!.volume / avgVol) : null,
    support: Math.min(...recent.map(c => c.low)),
    resistance: Math.max(...recent.map(c => c.high)),
  };
}
