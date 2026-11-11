// Chart cards in AI replies. The backend builds them from real candles (`show_chart` tool) and sends
// them as `chart` blocks while streaming and in saved message metadata. Kept free of React Native
// imports so parsing and layout can be unit-tested directly.

export type AiChartLine = { id: string; label: string; values: (number | null)[] };
export type AiChartLevel = { kind: 'support' | 'resistance'; label: string; price: number };
export type AiChart = {
  exchange: string;
  symbol: string;
  timeframe: string;
  chartType: 'candle' | 'line';
  /** [openTime ms, open, high, low, close], oldest first. */
  candles: [number, number, number, number, number][];
  lines: AiChartLine[];
  levels: AiChartLevel[];
  pricePrecision: number;
  lastClose: number;
  changePercent: number;
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 40) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);

/** Validates one block from the server; anything malformed is dropped rather than drawn wrong. */
export function parseChartBlock(block: unknown): AiChart | null {
  if (!block || typeof block !== 'object' || (block as { type?: unknown }).type !== 'chart') return null;
  const d = (block as { data?: unknown }).data as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return null;
  const symbol = str(d.symbol, 30), exchange = str(d.exchange, 20), timeframe = str(d.timeframe, 5);
  if (!symbol || !exchange || !timeframe || !Array.isArray(d.candles)) return null;
  const candles = d.candles.filter((c): c is AiChart['candles'][number] =>
    Array.isArray(c) && c.length === 5 && c.every(isNum) && c[2] >= c[3]);
  if (candles.length < 2) return null;
  const lines = (Array.isArray(d.lines) ? d.lines : []).flatMap((l: any) => {
    const id = str(l?.id), label = str(l?.label);
    if (!id || !label || !Array.isArray(l.values) || l.values.length !== candles.length) return [];
    return [{ id, label, values: l.values.map((v: unknown) => (isNum(v) ? v : null)) }];
  });
  const levels = (Array.isArray(d.levels) ? d.levels : []).flatMap((l: any) =>
    (l?.kind === 'support' || l?.kind === 'resistance') && isNum(l.price) && str(l.label, 80)
      ? [{ kind: l.kind, label: l.label, price: l.price } as AiChartLevel] : []);
  const last = candles[candles.length - 1]!;
  return {
    exchange, symbol, timeframe, candles, lines, levels,
    chartType: d.chartType === 'line' ? 'line' : 'candle',
    pricePrecision: isNum(d.pricePrecision) ? Math.max(0, Math.min(10, Math.round(d.pricePrecision))) : 2,
    lastClose: isNum(d.lastClose) ? d.lastClose : last[4],
    changePercent: isNum(d.changePercent) ? d.changePercent : 0,
  };
}

/** Charts from a list of blocks (live `block` events or saved `metadata.blocks`). */
export function chartsFromBlocks(blocks: unknown): AiChart[] {
  return Array.isArray(blocks) ? blocks.map(parseChartBlock).filter((c): c is AiChart => c !== null) : [];
}

// ---- Layout -------------------------------------------------------------------------------------

export type ChartPoint = { x: number; y: number };
export type ChartLayout = {
  min: number;
  max: number;
  /** Pixel y for a price. */
  y: (price: number) => number;
  candles: { x: number; width: number; wickTop: number; wickBottom: number; bodyTop: number; bodyHeight: number; up: boolean }[];
  close: ChartPoint[];
  /** Each line split into runs without gaps. */
  lines: { id: string; label: string; runs: ChartPoint[][] }[];
  levels: (AiChartLevel & { y: number })[];
  /** Price gridlines, top to bottom. */
  ticks: { price: number; y: number }[];
};

export function layoutChart(chart: AiChart, width: number, height: number): ChartLayout {
  const prices = [
    ...chart.candles.flatMap(c => (chart.chartType === 'candle' ? [c[2], c[3]] : [c[4]])),
    ...chart.lines.flatMap(l => l.values.filter(isNum)),
    ...chart.levels.map(l => l.price),
  ];
  const low = Math.min(...prices), high = Math.max(...prices);
  const pad = Math.max((high - low) * 0.06, Math.abs(high) * 0.0005, 1e-9);
  const min = low - pad, max = high + pad;
  const y = (price: number) => ((max - price) / (max - min)) * height;
  const step = width / chart.candles.length;
  const x = (i: number) => step * (i + 0.5);
  const bodyWidth = Math.max(1, Math.min(10, step * 0.7));
  return {
    min, max, y,
    candles: chart.candles.map(([, open, hi, lo, close], i) => {
      const top = y(Math.max(open, close)), bottom = y(Math.min(open, close));
      return { x: x(i), width: bodyWidth, wickTop: y(hi), wickBottom: y(lo), bodyTop: top, bodyHeight: Math.max(1, bottom - top), up: close >= open };
    }),
    close: chart.candles.map((c, i) => ({ x: x(i), y: y(c[4]) })),
    lines: chart.lines.map(l => {
      const runs: ChartPoint[][] = [];
      let run: ChartPoint[] = [];
      l.values.forEach((v, i) => {
        if (v === null) { if (run.length) runs.push(run); run = []; return; }
        run.push({ x: x(i), y: y(v) });
      });
      if (run.length) runs.push(run);
      return { id: l.id, label: l.label, runs: runs.filter(r => r.length > 1) };
    }),
    levels: chart.levels.map(l => ({ ...l, y: y(l.price) })),
    ticks: [0, 1 / 3, 2 / 3, 1].map(f => ({ price: max - (max - min) * f, y: height * f })),
  };
}

/** Straight segments between points, positioned for rotated 2px Views (no SVG in this app). */
export function lineSegments(points: ChartPoint[]) {
  return points.slice(1).map((p, i) => {
    const a = points[i]!;
    const length = Math.hypot(p.x - a.x, p.y - a.y);
    return { left: (a.x + p.x - length) / 2, top: (a.y + p.y) / 2 - 1, width: length, angle: Math.atan2(p.y - a.y, p.x - a.x) };
  });
}
