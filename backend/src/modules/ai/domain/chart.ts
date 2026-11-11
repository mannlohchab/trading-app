// Chart cards for assistant replies. Pure: built from real candles, never from model text, so the
// picture always matches observed data. Moving averages use extra history before the visible window.

export const CHART_OVERLAYS = ['SMA20', 'SMA50', 'EMA20', 'SUPPORT_RESISTANCE'] as const;
export type ChartOverlay = (typeof CHART_OVERLAYS)[number];
type LineId = Exclude<ChartOverlay, 'SUPPORT_RESISTANCE'>;

/** Candles a moving average needs before the visible window so its first point is real. */
export const CHART_WARMUP = 50;
/** Support/resistance use the same 30-candle window as `summarizeMarket`. */
const LEVEL_WINDOW = 30;

export type ChartCandleInput = { openTime: number; open: string; high: string; low: string; close: string; isClosed: boolean };

export type ChartData = {
  exchange: string;
  symbol: string;
  timeframe: string;
  chartType: 'candle' | 'line';
  /** [openTime ms, open, high, low, close], oldest first. */
  candles: [number, number, number, number, number][];
  /** One value per candle; null where there is not enough history. */
  lines: { id: LineId; label: string; values: (number | null)[] }[];
  levels: { kind: 'support' | 'resistance'; label: string; price: number }[];
  pricePrecision: number;
  lastClose: number;
  changePercent: number;
  source: string;
};

const LINE_LABEL: Record<LineId, string> = { SMA20: 'SMA 20', SMA50: 'SMA 50', EMA20: 'EMA 20' };

function smaSeries(values: number[], period: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period]!;
    return i >= period - 1 ? sum / period : null;
  });
}

function emaSeries(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  let prev: number | null = null;
  return values.map((v, i) => {
    if (i < period - 1) return null;
    prev = prev === null ? values.slice(0, period).reduce((a, b) => a + b, 0) / period : v * k + prev * (1 - k);
    return prev;
  });
}

const decimals = (price: string) => (price.split('.')[1] ?? '').replace(/0+$/, '').length;
const round = (v: number, precision: number) => Number(v.toFixed(Math.min(precision + 2, 10)));

/**
 * Builds a chart from closed candles (oldest first). `visible` is how many of the newest candles to
 * show; earlier ones only warm up moving averages. Returns null with fewer than 2 visible candles.
 */
export function buildChart(input: {
  exchange: string; symbol: string; timeframe: string; chartType: 'candle' | 'line';
  candles: ChartCandleInput[]; visible: number; overlays: readonly ChartOverlay[]; source: string;
}): ChartData | null {
  const all = input.candles.filter(c => c.isClosed);
  const start = Math.max(0, all.length - input.visible);
  const shown = all.slice(start);
  if (shown.length < 2) return null;

  const pricePrecision = Math.max(2, Math.min(8, Math.max(...shown.flatMap(c => [decimals(c.open), decimals(c.high), decimals(c.low), decimals(c.close)]))));
  const closes = all.map(c => Number(c.close));
  const series: Record<LineId, () => (number | null)[]> = {
    SMA20: () => smaSeries(closes, 20), SMA50: () => smaSeries(closes, 50), EMA20: () => emaSeries(closes, 20),
  };
  const lines = [...new Set(input.overlays)]
    .filter((o): o is LineId => o !== 'SUPPORT_RESISTANCE')
    .map(id => ({ id, label: LINE_LABEL[id], values: series[id]().slice(start).map(v => (v === null ? null : round(v, pricePrecision))) }))
    .filter(line => line.values.some(v => v !== null));

  const recent = shown.slice(-LEVEL_WINDOW);
  const levels = input.overlays.includes('SUPPORT_RESISTANCE')
    ? [
        { kind: 'resistance' as const, label: `Resistance (${recent.length}-candle high)`, price: Math.max(...recent.map(c => Number(c.high))) },
        { kind: 'support' as const, label: `Support (${recent.length}-candle low)`, price: Math.min(...recent.map(c => Number(c.low))) },
      ]
    : [];

  const first = Number(shown[0]!.open);
  const lastClose = Number(shown.at(-1)!.close);
  return {
    exchange: input.exchange,
    symbol: input.symbol,
    timeframe: input.timeframe,
    chartType: input.chartType,
    candles: shown.map(c => [c.openTime, Number(c.open), Number(c.high), Number(c.low), Number(c.close)]),
    lines,
    levels,
    pricePrecision,
    lastClose,
    changePercent: first ? Math.round(((lastClose - first) / first) * 10_000) / 100 : 0,
    source: input.source,
  };
}
