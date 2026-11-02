import type { HistoryResponse } from './marketHistory';

// These ranges fit the provider's available seven-day intraday / 90-day daily history.
export const PREVIEW_RANGES = [
  { label: '1D', days: 1, timeframe: '5m' },
  { label: '7D', days: 7, timeframe: '1h' },
  { label: '15D', days: 15, timeframe: '1d' },
  { label: '1M', days: 30, timeframe: '1d' },
  { label: '3M', days: 90, timeframe: '1d' },
] as const;
export type PreviewRange = typeof PREVIEW_RANGES[number]['label'];
export type PreviewPoint = { time: number; value: number; x: number; y: number };

const utcDate = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);

export function buildPreviewChart(history: HistoryResponse | undefined, range: PreviewRange, allowDemo = false) {
  if (!history || (history.isDemo !== false && !(allowDemo && history.isDemo === true))) return null;
  const unique = new Map<number, number>();
  for (const candle of history.candles) {
    if (Number.isFinite(candle.time) && candle.time > 0 && candle.time < 8e12 && Number.isFinite(candle.close) && candle.close > 0) {
      unique.set(candle.time, candle.close);
    }
  }
  const sorted = [...unique].sort(([a], [b]) => a - b);
  if (sorted.length < 2) return null;
  const end = sorted[sorted.length - 1][0];
  const days = PREVIEW_RANGES.find(r => r.label === range)!.days;
  const source = history.source ?? history.candles[0]?.source;
  // Forex 1D is the latest UTC session; crypto (24/7) uses a rolling window.
  const samples = sorted.filter(([time]) => range === '1D' && source !== 'binance' && history.assetClass !== 'crypto'
    ? utcDate(time) === utcDate(end)
    : time >= end - days * 86_400);
  if (samples.length < 2) return null;
  const values = samples.map(([, value]) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.12, high * 0.001);
  const min = low - padding;
  const max = high + padding;
  const start = samples[0][0];
  const points = samples.map(([time, value]) => ({
    time, value,
    x: (time - start) / (end - start) * 100,
    y: 100 - (value - min) / (max - min) * 100,
  }));
  return { points, min, max, start, end };
}

export function nearestChartPoint(points: PreviewPoint[], xPercent: number) {
  return points.reduce((nearest, point) => Math.abs(point.x - xPercent) < Math.abs(nearest.x - xPercent) ? point : nearest);
}

export function previewLineSegments(points: PreviewPoint[], width: number, height: number) {
  return points.slice(1).map((point, i) => {
    const previous = points[i];
    const x1 = previous.x / 100 * width, x2 = point.x / 100 * width;
    const y1 = previous.y / 100 * height, y2 = point.y / 100 * height;
    const length = Math.hypot(x2 - x1, y2 - y1);
    return { left: (x1 + x2 - length) / 2, top: (y1 + y2) / 2 - 1,
      width: length, angle: Math.atan2(y2 - y1, x2 - x1) };
  });
}
