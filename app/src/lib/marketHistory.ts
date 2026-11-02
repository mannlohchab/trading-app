export type HistoryResponse = {
  candles: { time: number; close: number; source?: 'angelone' | 'yahoo' | 'demo' | 'binance' | 'twelvedata' }[];
  assetClass?: string;
  isDemo: boolean;
  source?: 'angelone' | 'yahoo' | 'demo' | 'binance' | 'twelvedata';
};

const indianDate = (time: number) => new Date((time + 19_800) * 1000).toISOString().slice(0, 10);

/** Demo series require an explicit preview opt-in; live failures stay empty. */
export function buildHistoryChart(history?: HistoryResponse, allowDemo = false) {
  if (!history || (history.isDemo !== false && !(allowDemo && history.isDemo === true))) return null;
  const unique = new Map<number, number>();
  for (const candle of history.candles) {
    if (Number.isFinite(candle.time) && candle.time > 0 && candle.time < 8e12 && Number.isFinite(candle.close) && candle.close > 0) {
      unique.set(candle.time, candle.close);
    }
  }
  const sorted = [...unique].sort(([a], [b]) => a - b);
  if (!sorted.length) return null;
  const source = history.source ?? history.candles[0]?.source;
  const date = source === 'twelvedata' || history.assetClass === 'forex' ? (time: number) => new Date(time * 1000).toISOString().slice(0,10) : indianDate;
  const end = sorted[sorted.length - 1][0];
  const sessionDate = source === 'binance' || history.assetClass === 'crypto' ? '24h' : date(end);
  const samples = sorted.filter(([time]) => source === 'binance' || history.assetClass === 'crypto' ? time > end - 86400 : date(time) === sessionDate);
  if (samples.length < 2) return null;
  const high = Math.max(...samples.map(([, price]) => price));
  const low = Math.min(...samples.map(([, price]) => price));
  const start = samples[0][0];
  const duration = samples[samples.length - 1][0] - start;
  const points = samples.map(([time, value]) => ({
    time,
    x: 3 + ((time - start) / duration) * 154,
    y: high === low ? 59 : 85 - ((value - low) / (high - low)) * 52,
    value,
  }));
  const peak = points.find((point) => point.value === high)!;
  return {
    points,
    peak,
    sessionDate,
    positive: samples[samples.length - 1][1] >= samples[0][1],
    path: points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '),
  };
}

type MiniPoint = { x: number; y: number; value: number };
type QuoteSeries = { sparkline?: number[]; source?: 'angelone' | 'yahoo' | 'demo' | 'binance' | 'twelvedata' };

/** Quotes can already contain a real price series, even if the history request fails. */
export function buildWatchlistChart(history: HistoryResponse | undefined, quote: QuoteSeries, allowDemo = false) {
  const dated = buildHistoryChart(history, allowDemo);
  if (dated) return { points: dated.points, peak: dated.peak, positive: dated.positive,
    caption: `${history?.isDemo ? 'Demo · ' : ''}${dated.sessionDate} · 5m` };
  if (quote.source !== 'angelone' && quote.source !== 'yahoo' && quote.source !== 'binance' && quote.source !== 'twelvedata' && !(allowDemo && quote.source === 'demo')) return null;
  const values = quote.sparkline;
  if (!values || values.length < 2 || values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const high = Math.max(...values), low = Math.min(...values);
  // This series has no timestamps: preserve observation order without inventing a session date.
  const points = values.map((value, i) => ({
    x: 3 + i / (values.length - 1) * 154,
    y: high === low ? 59 : 85 - (value - low) / (high - low) * 52,
    value,
  }));
  return { points, peak: points.find(point => point.value === high)!, positive: values[values.length - 1] >= values[0],
    caption: quote.source === 'demo' ? 'Demo prices' : 'Recent prices' };
}

/** Place each native line around its midpoint, so rotation joins adjacent points exactly. */
export function watchlistLineSegments(points: MiniPoint[], width: number) {
  return points.slice(1).map((point, i) => {
    const previous = points[i];
    const x1 = previous.x / 160 * width, x2 = point.x / 160 * width;
    const dx = x2 - x1, dy = point.y - previous.y;
    const length = Math.hypot(dx, dy);
    return { left: (x1 + x2 - length) / 2, top: (previous.y + point.y) / 2 - 0.9,
      width: length, angle: Math.atan2(dy, dx) };
  });
}
