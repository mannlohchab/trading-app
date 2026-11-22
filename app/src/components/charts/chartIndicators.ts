// Math for the studies that run inside the chart page. This is a source string, not a function,
// because Hermes prints Function.toString() as "{ [bytecode] }" and that would crash the WebView.
// Keep the helpers pure: they only see the candles array the page passes in.

export type StudyPane = 'macd' | 'rsi' | 'atr';

export type StudyLayout = {
  panes: StudyPane[];
  priceTop: number;
  priceBottom: number;
  /** Fraction of the plot taken by oscillator panes, measured from the bottom. */
  oscShare: number;
  volumeMargins: { top: number; bottom: number } | null;
  margins: Partial<Record<StudyPane, { top: number; bottom: number }>>;
};

const PRICE_TOP = 0.16;

/**
 * Splits the chart into a candle region, an optional volume band, and oscillator panes.
 * Volume on its own keeps the original margins so an unchanged chart looks the same.
 */
export function studyLayout(indicators: readonly string[]): StudyLayout {
  const panes: StudyPane[] = [];
  if (indicators.includes('MACD')) panes.push('macd');
  if (indicators.includes('RSI')) panes.push('rsi');
  if (indicators.includes('ATR')) panes.push('atr');
  const showVolume = indicators.includes('VOL');

  if (!panes.length) {
    return {
      panes,
      priceTop: PRICE_TOP,
      priceBottom: showVolume ? 0.22 : 0.06,
      oscShare: 0,
      volumeMargins: showVolume ? { top: 0.8, bottom: 0 } : null,
      margins: {},
    };
  }

  // Leave the candles at least a third of the plot, even with every oscillator on.
  const minCandles = 0.34;
  const maxBottom = 1 - PRICE_TOP - minCandles;
  const gap = 0.01;
  const volumeBand = showVolume ? 0.11 : 0;
  const cushion = showVolume ? 0.008 : 0.016;
  const gaps = gap * Math.max(0, panes.length - 1);
  const available = Math.max(0, maxBottom - volumeBand - cushion - gaps);
  const preferred = panes.length >= 3 ? 0.145 : 0.17;
  const paneH = Math.min(preferred, available / panes.length);
  const oscShare = paneH * panes.length + gaps;
  const priceBottom = Math.min(maxBottom, oscShare + volumeBand + cushion);
  const margins: StudyLayout['margins'] = {};
  let bottom = 0;
  for (let i = panes.length - 1; i >= 0; i--) {
    const id = panes[i]!;
    margins[id] = { top: 1 - (bottom + paneH), bottom };
    bottom += paneH + gap;
  }
  return {
    panes,
    priceTop: PRICE_TOP,
    priceBottom,
    oscShare,
    volumeMargins: showVolume ? { top: Math.max(0, 1 - oscShare - volumeBand), bottom: oscShare } : null,
    margins,
  };
}

export const indicatorMathSource = `
function inSession(hour, start, end) {
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
function emaSeeded(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period || period < 1) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsiPoints(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period || period < 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const at = (i) => { out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); };
  at(period);
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    at(i);
  }
  return out;
}
function macdPoints(candles, fast, slow, signal) {
  const closes = candles.map(c => c.close);
  const fastE = emaSeeded(closes, fast);
  const slowE = emaSeeded(closes, slow);
  const line = closes.map((_, i) => fastE[i] == null || slowE[i] == null ? null : fastE[i] - slowE[i]);
  const packed = [], packedIndex = [];
  for (let i = 0; i < line.length; i++) if (line[i] != null) { packed.push(line[i]); packedIndex.push(i); }
  const sig = emaSeeded(packed, signal);
  const macd = new Array(candles.length).fill(null);
  const signalLine = new Array(candles.length).fill(null);
  const histogram = new Array(candles.length).fill(null);
  for (let j = 0; j < packed.length; j++) {
    if (sig[j] == null) continue;
    const i = packedIndex[j];
    macd[i] = packed[j];
    signalLine[i] = sig[j];
    histogram[i] = packed[j] - sig[j];
  }
  return { macd, signal: signalLine, histogram };
}
function atrPoints(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period || period < 1) return out;
  const tr = new Array(candles.length);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}
function supertrendPoints(candles, period, multiplier) {
  const atr = atrPoints(candles, period);
  const value = new Array(candles.length).fill(null);
  const trend = new Array(candles.length).fill(null);
  let prevUp = null, prevDn = null, prevTrend = 1;
  for (let i = 0; i < candles.length; i++) {
    if (atr[i] == null) continue;
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    const hl2 = (c.high + c.low) / 2;
    let up = hl2 - multiplier * atr[i];
    let dn = hl2 + multiplier * atr[i];
    const up1 = prevUp == null ? up : prevUp;
    const dn1 = prevDn == null ? dn : prevDn;
    up = prevClose > up1 ? Math.max(up, up1) : up;
    dn = prevClose < dn1 ? Math.min(dn, dn1) : dn;
    let next = prevTrend;
    if (next === -1 && c.close > dn1) next = 1;
    else if (next === 1 && c.close < up1) next = -1;
    value[i] = next === 1 ? up : dn;
    trend[i] = next;
    prevUp = up; prevDn = dn; prevTrend = next;
  }
  return { value, trend };
}
// Fixed UTC windows. They do not shift for daylight saving; that matches a 24h crypto book.
const TRADING_SESSIONS = [
  { id: 'sydney', name: 'Sydney', start: 21, end: 6, fill: 'rgba(156,39,176,0.13)', swatch: '#9C27B0' },
  { id: 'tokyo', name: 'Tokyo', start: 0, end: 9, fill: 'rgba(41,98,255,0.12)', swatch: '#2962FF' },
  { id: 'london', name: 'London', start: 7, end: 16, fill: 'rgba(247,162,27,0.16)', swatch: '#F7A21B' },
  { id: 'newyork', name: 'New York', start: 12, end: 21, fill: 'rgba(8,153,129,0.13)', swatch: '#089981' },
];
function sessionsAt(unixSeconds) {
  const hour = new Date(unixSeconds * 1000).getUTCHours();
  const on = [];
  for (let i = 0; i < TRADING_SESSIONS.length; i++) {
    const session = TRADING_SESSIONS[i];
    if (inSession(hour, session.start, session.end)) on.push(session.id);
  }
  return on;
}
`;
