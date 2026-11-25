import { liveChartScript } from './chartLive';
import { drawingToolsCss, drawingToolsHtml, drawingToolsScript, type ChartDrawing } from './chartDrawingTools';
import { indicatorMathSource, studyLayout } from './chartIndicators';


export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Opening window: the latest candle, the one still updating, sits just inside the right edge.
 * About one candle per 22 px, so a phone shows roughly 16–18 bars.
 */
export function movingCandleRange(count: number, width: number) {
  const slots = Math.min(60, Math.max(12, Math.round(Math.max(width, 280) / 22)));
  const last = Math.max(0, count - 1);
  return { from: last - (slots - 1), to: last + 1 };
}

// Hermes Function.toString() is "{ [bytecode] }", which throws inside the chart page and
// stops the script before the drawing tools are installed. Keep this copy in sync with the function above.
const movingCandleRangeSource = `function(count, width) {
  const slots = Math.min(60, Math.max(12, Math.round(Math.max(width, 280) / 22)));
  const last = Math.max(0, count - 1);
  return { from: last - (slots - 1), to: last + 1 };
}`;

/**
 * Theme colours for the chart page. Keys match the app palette's chart tokens, so the active
 * palette can be passed straight in. Defaults are the light theme.
 */
export type ChartColors = {
  chartBg: string; chartText: string; chartMuted: string; chartGrid: string;
  chartCrosshair: string; chartUp: string; chartDown: string; chartLine: string;
  /** Dark theme: picks dark variants of the few page colours that have no palette token. */
  dark?: boolean;
};

export const LIGHT_CHART_COLORS: ChartColors = {
  chartBg: '#FFFFFF', chartText: '#131722', chartMuted: '#787B86', chartGrid: '#E0E3EB',
  chartCrosshair: '#9598A1', chartUp: '#089981', chartDown: '#F23645', chartLine: '#2962FF', dark: false,
};

/** "#RRGGBB" plus an alpha as an rgba() string; other formats pass through unchanged. */
function withAlpha(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  return `rgba(${parseInt(match[1], 16)},${parseInt(match[2], 16)},${parseInt(match[3], 16)},${alpha})`;
}

export function buildChartHtml(
  candles: ChartCandle[],
  chartType: string,
  indicators: string[],
  symbol = '',
  initialDrawings: ChartDrawing[] = [],
  drawingKey = symbol,
  pricePrecision = 2,
  currency = 'USD',
  options: {
    exchange?: string; timeframe?: string; /** Pair name shown top-left, e.g. "XRP / U.S. Dollar". */ title?: string;
    /** Filled paper trades, unix seconds and fill price. The page snaps each one onto a candle. */
    trades?: { time: number; price: number; side: 'BUY' | 'SELL' }[];
    /** Theme colours; omitted keys fall back to the light theme. */
    colors?: Partial<ChartColors>;
  } = {},
) {
  const theme = { ...LIGHT_CHART_COLORS, ...options.colors };
  const dark = theme.dark === true;
  // No palette tokens for these: the light values are the originals, the dark ones suit chartBg.
  const gridLine = dark ? theme.chartGrid : 'rgba(42,46,57,0.08)';
  const drawActive = dark ? '#1E222D' : '#F0F3FA';
  const drawPressed = dark ? '#1A2747' : '#E3ECFF';
  const drawDangerBg = dark ? '#2A1418' : '#FFF1F3';
  const drawDangerBorder = dark ? '#5C2630' : '#FECDD3';
  const timeframe = options.timeframe ?? '';
  const timeframeSeconds = ({ '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 } as Record<string, number>)[timeframe] ?? 0;
  const legendTitle = options.title || [symbol, timeframe, options.exchange].filter(Boolean).join(' · ');
  const data = JSON.stringify(candles);
  pricePrecision = Math.max(0, Math.min(12, pricePrecision));
  const inds = JSON.stringify(indicators);
  const layout = studyLayout(indicators);
  const showVolume = layout.volumeMargins != null;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  :root{color-scheme:${dark ? 'dark' : 'light'};--chart-bg:${theme.chartBg};--chart-text:${theme.chartText};--chart-muted:${theme.chartMuted};--chart-grid:${theme.chartGrid};--chart-line:${theme.chartLine};--chart-down:${theme.chartDown};--draw-menu-bg:${withAlpha(theme.chartBg, 0.96)};--draw-active:${drawActive};--draw-pressed:${drawPressed};--draw-danger-bg:${drawDangerBg};--draw-danger-border:${drawDangerBorder};}
  html,body,#wrap{margin:0;padding:0;height:100%;background:var(--chart-bg);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;}
  #chart{height:100%;}
  /* The app overlays its close button at the top-left, so the title row starts after it. */
  #legend{position:absolute;left:12px;top:10px;z-index:6;pointer-events:none;line-height:1.3;max-width:calc(100% - 110px);}
  #legend .title{display:flex;align-items:center;gap:10px;padding-left:42px;min-height:30px;font-size:20px;color:var(--chart-text);letter-spacing:-.2px;white-space:nowrap;}
  #legend .title span{overflow:hidden;text-overflow:ellipsis;}
  #legend .dot{flex:none;width:10px;height:10px;border-radius:50%;background:#22AB94;box-shadow:0 0 0 5px rgba(34,171,148,.16);}
  #legend .quote{font-size:17px;margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap;}
  #legend .quote span{margin-right:7px;}
  #legend .time{font-size:12px;color:var(--chart-muted);}
  #study-legend{position:absolute;left:54px;top:68px;z-index:5;pointer-events:none;display:flex;flex-direction:column;gap:3px;max-width:calc(100% - 70px);}
  #study-legend .study-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11px;line-height:1.35;color:var(--chart-text);font-variant-numeric:tabular-nums;}
  #study-legend .study-row span{display:inline-flex;align-items:center;}
  #study-legend .study-row i{width:8px;height:8px;border-radius:2px;margin-right:4px;}
  #study-legend .off{opacity:.35;}
  #session-layer{position:absolute;left:0;top:0;z-index:1;pointer-events:none;overflow:hidden;}
  #pane-readout{position:absolute;left:0;top:0;right:0;z-index:4;pointer-events:none;}
  .pane-readout{position:absolute;left:8px;right:72px;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:11px;line-height:1.35;font-variant-numeric:tabular-nums;color:var(--chart-text);}
  .pane-readout b{font-weight:600;color:var(--chart-muted);}
${drawingToolsCss}
</style>
<script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
<div id="wrap">
  <div id="chart"></div>
  <svg id="session-layer" aria-hidden="true"></svg>
  <div id="pane-readout" aria-hidden="true"></div>
  <div id="legend" aria-live="off"><div class="title"><span></span><i class="dot"></i></div><div class="quote"></div></div>
  <div id="study-legend" aria-hidden="true"></div>
  ${drawingToolsHtml}
</div>
<script>
  // Report script errors to the app, which logs them: otherwise a failure inside the WebView is silent.
  window.addEventListener('error', event => {
    const message = JSON.stringify({ type: 'chart-error', message: String(event.message || event.error || 'Unknown error').slice(0, 300) });
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message); else window.parent.postMessage(message, '*'); } catch (_) {}
  });
</script>
<script>
  const candles = ${data};
  const chartType = ${JSON.stringify(chartType)};
  const indicators = ${inds};
  const symbol = ${JSON.stringify(symbol).replace(/</g, '\\u003c')};
  const currency = ${JSON.stringify(currency).replace(/</g, '\\u003c')};
  const pricePrecision = ${pricePrecision};
  const priceFormat = {type:'price', precision:pricePrecision, minMove:Math.pow(10,-pricePrecision)};
  const indicatorSeries = [];
  let volumeSeries = null;
  const showVolume = ${showVolume ? 'true' : 'false'};
  const studyPane = ${JSON.stringify({ panes: layout.panes, oscShare: layout.oscShare, margins: layout.margins })};
  const intradaySessions = ${timeframeSeconds > 0 && timeframeSeconds < 86400 ? 'true' : 'false'};
  const initialDrawings = ${JSON.stringify(initialDrawings)};
  const drawingKey = ${JSON.stringify(drawingKey).replace(/</g, '\\u003c')};
  const grid = ${JSON.stringify(gridLine)};
  const TEXT = ${JSON.stringify(theme.chartText)};
  const MUTED = ${JSON.stringify(theme.chartMuted)};
  const CHART_BG = ${JSON.stringify(theme.chartBg)};
  const UP = ${JSON.stringify(theme.chartUp)}, DOWN = ${JSON.stringify(theme.chartDown)};
  // Dimmed so volume reads as a backdrop under the candles.
  const UP_VOL = ${JSON.stringify(withAlpha(theme.chartUp, 0.35))}, DOWN_VOL = ${JSON.stringify(withAlpha(theme.chartDown, 0.35))};
  const legendTitle = ${JSON.stringify(legendTitle).replace(/</g, '\\u003c')};
  const timeframeSeconds = ${timeframeSeconds};
  const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: { background: { color: CHART_BG }, textColor: TEXT, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif', fontSize: 13 },
    grid: { vertLines: { color: grid, style: LightweightCharts.LineStyle.Dotted }, horzLines: { color: grid, style: LightweightCharts.LineStyle.Dotted } },
    // Room at the top for the title, and below the candles for volume and oscillator panes.
    rightPriceScale: { borderVisible: false, scaleMargins: { top: ${layout.priceTop}, bottom: ${layout.priceBottom} } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: ${JSON.stringify(theme.chartCrosshair)}, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: TEXT },
      horzLine: { color: ${JSON.stringify(theme.chartCrosshair)}, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: TEXT },
    },
    localization: { priceFormatter: p => Number(p).toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision }) },
    handleScroll: true,
    handleScale: true,
  });

  let series;
  if (chartType === 'line') {
    series = chart.addLineSeries({ color: ${JSON.stringify(theme.chartLine)}, lineWidth: 2, priceLineVisible: false });
    series.setData(candles.map(c => ({ time: c.time, value: c.close })));
  } else if (chartType === 'area') {
    series = chart.addAreaSeries({
      lineColor: ${JSON.stringify(theme.chartLine)}, topColor: ${JSON.stringify(withAlpha(theme.chartLine, 0.24))}, bottomColor: ${JSON.stringify(withAlpha(theme.chartLine, 0.02))},
      priceLineVisible: false,
    });
    series.setData(candles.map(c => ({ time: c.time, value: c.close })));
  } else {
    series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
      priceLineVisible: false,
    });
    series.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  }

  // The dashed price line carries the last-price label (and countdown); avoid a duplicate series label.
  series.applyOptions({priceFormat, lastValueVisible: false});
  let priceLine = null;
  const last = candles[candles.length - 1];
  if (last) {
    const up = last.close >= last.open;
    priceLine = series.createPriceLine({
      price: last.close,
      color: up ? UP : DOWN,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: '',
    });
  }

  if (showVolume) {
    // Volume sits on its own hidden scale, in the band above any oscillator panes.
    const vol = volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volume', priceLineVisible: false, lastValueVisible: false });
    chart.priceScale('volume').applyOptions({ scaleMargins: ${JSON.stringify(layout.volumeMargins)}, visible: false });
    vol.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? UP_VOL : DOWN_VOL,
    })));
  }

  ${indicatorMathSource}
  let studyCache = null;
  function studies() {
    let sum = 0;
    for (let i = 0; i < candles.length; i++) sum += candles[i].high + candles[i].low + candles[i].close;
    const last = candles[candles.length - 1];
    const token = candles.length + '|' + (last ? last.time : '') + '|' + sum;
    if (studyCache && studyCache.token === token) return studyCache;
    const rsi = indicators.includes('RSI') ? rsiPoints(candles, 14) : null;
    const macd = indicators.includes('MACD') ? macdPoints(candles, 12, 26, 9) : null;
    const atr = indicators.includes('ATR') ? atrPoints(candles, 14) : null;
    const st = indicators.includes('ST') ? supertrendPoints(candles, 10, 3) : null;
    const mapOf = (values) => {
      const map = new Map();
      if (!values) return map;
      for (let i = 0; i < candles.length && i < values.length; i++) {
        if (values[i] != null && Number.isFinite(values[i])) map.set(candles[i].time, values[i]);
      }
      return map;
    };
    studyCache = {
      token, rsi, macd, atr, st,
      rsiMap: mapOf(rsi), atrMap: mapOf(atr),
      macdMap: mapOf(macd && macd.macd), signalMap: mapOf(macd && macd.signal), histMap: mapOf(macd && macd.histogram),
      stValue: mapOf(st && st.value), stTrend: mapOf(st && st.trend),
    };
    return studyCache;
  }
  function studyPoints(values) {
    const out = [];
    if (!values) return out;
    for (let i = 0; i < candles.length && i < values.length; i++) {
      if (values[i] != null && Number.isFinite(values[i])) out.push({ time: candles[i].time, value: values[i] });
    }
    return out;
  }
  function useStudyScale(id) {
    chart.priceScale(id).applyOptions({ scaleMargins: studyPane.margins[id], visible: false, borderVisible: false });
  }
  function addStudyLine(scaleId, color, values, format, autoscale) {
    const options = {
      color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: scaleId, priceFormat: format || priceFormat,
    };
    if (autoscale) options.autoscaleInfoProvider = autoscale;
    const indicator = chart.addLineSeries(options);
    indicator.setData(values());
    indicatorSeries.push({ series: indicator, values });
    return indicator;
  }

  function sma(period) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      if (i + 1 < period) continue;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      out.push({ time: candles[i].time, value: sum / period });
    }
    return out;
  }
  function ema(period) {
    const out = [];
    const k = 2 / (period + 1);
    let prev;
    for (let i = 0; i < candles.length; i++) {
      const price = candles[i].close;
      prev = prev === undefined ? price : price * k + prev * (1 - k);
      if (i + 1 >= period) out.push({ time: candles[i].time, value: prev });
    }
    return out;
  }
  function bollinger(period = 20, mult = 2) {
    const mid = [], upper = [], lower = [];
    for (let i = 0; i < candles.length; i++) {
      if (i + 1 < period) continue;
      const slice = candles.slice(i - period + 1, i + 1).map(c => c.close);
      const mean = slice.reduce((a,b)=>a+b,0) / period;
      const variance = slice.reduce((a,b)=>a + (b-mean)**2, 0) / period;
      const sd = Math.sqrt(variance);
      mid.push({ time: candles[i].time, value: mean });
      upper.push({ time: candles[i].time, value: mean + mult * sd });
      lower.push({ time: candles[i].time, value: mean - mult * sd });
    }
    return { mid, upper, lower };
  }

  function addIndicator(color, values) {
    const indicator = chart.addLineSeries({ color, lineWidth:1, priceLineVisible:false, priceFormat });
    indicator.setData(values()); indicatorSeries.push({series:indicator,values});
  }
  if (indicators.includes('MA')) {
    addIndicator('#F7A21B', () => sma(20));
  }
  if (indicators.includes('EMA')) {
    addIndicator('#2962FF', () => ema(20));
  }
  if (indicators.includes('BB')) {
    addIndicator('#FF6D00', () => bollinger().mid);
    addIndicator('#2196F3', () => bollinger().upper);
    addIndicator('#2196F3', () => bollinger().lower);
  }
  if (indicators.includes('ST')) {
    const values = () => {
      const st = studies().st;
      const out = [];
      if (!st) return out;
      for (let i = 0; i < candles.length; i++) {
        const v = st.value[i];
        if (v == null || !Number.isFinite(v)) continue;
        out.push({ time: candles[i].time, value: v, color: st.trend[i] === 1 ? UP : DOWN });
      }
      return out;
    };
    const trend = chart.addLineSeries({ color: UP, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, priceFormat });
    trend.setData(values());
    indicatorSeries.push({ series: trend, values });
  }
  if (indicators.includes('RSI')) {
    const rsiFormat = { type: 'price', precision: 2, minMove: 0.01 };
    const rsiSeries = addStudyLine('rsi', '#7E57C2', () => studyPoints(studies().rsi), rsiFormat, () => ({ priceRange: { minValue: 0, maxValue: 100 } }));
    useStudyScale('rsi');
    const rsiLevel = (price, color) => rsiSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' });
    rsiLevel(70, ${JSON.stringify(withAlpha(theme.chartDown, 0.55))});
    rsiLevel(30, ${JSON.stringify(withAlpha(theme.chartUp, 0.55))});
  }
  if (indicators.includes('MACD')) {
    const histValues = () => {
      const macd = studies().macd;
      const out = [];
      if (!macd) return out;
      for (let i = 0; i < candles.length; i++) {
        const v = macd.histogram[i];
        if (v == null || !Number.isFinite(v)) continue;
        out.push({ time: candles[i].time, value: v, color: v >= 0 ? ${JSON.stringify(withAlpha(theme.chartUp, 0.8))} : ${JSON.stringify(withAlpha(theme.chartDown, 0.8))} });
      }
      return out;
    };
    const hist = chart.addHistogramSeries({ priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false, priceFormat });
    hist.setData(histValues());
    indicatorSeries.push({ series: hist, values: histValues });
    useStudyScale('macd');
    const macdLine = addStudyLine('macd', '#2962FF', () => { const macd = studies().macd; return studyPoints(macd && macd.macd); });
    addStudyLine('macd', '#F7A21B', () => { const macd = studies().macd; return studyPoints(macd && macd.signal); });
    macdLine.createPriceLine({ price: 0, color: ${JSON.stringify(withAlpha(theme.chartMuted, 0.7))}, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' });
  }
  if (indicators.includes('ATR')) {
    addStudyLine('atr', '#00897B', () => studyPoints(studies().atr));
    useStudyScale('atr');
  }

  const movingCandleRange = ${movingCandleRangeSource};
  let openedOnMovingCandle = false;
  function zoomToMovingCandle() {
    const width = Math.max(chart.timeScale().width() || 0, window.innerWidth || 0);
    if (width < 40 || !candles.length) return;
    chart.timeScale().setVisibleLogicalRange(movingCandleRange(candles.length, width));
    openedOnMovingCandle = true;
  }

  // TradingView-style legend: latest bar by default, hovered bar while the crosshair is active.
  const legend = document.getElementById('legend');
  legend.querySelector('.title span').textContent = legendTitle;
  const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision });
  function renderLegend(index, hovered) {
    const bar = candles[index]; if (!bar) return;
    const previous = candles[index - 1];
    const base = previous ? previous.close : bar.open;
    const change = bar.close - base, pct = base ? change / base * 100 : 0;
    const quote = legend.querySelector('.quote');
    quote.style.color = change >= 0 ? UP : DOWN;
    quote.innerHTML = '';
    for (const text of [fmt(bar.close), (change >= 0 ? '+' : '') + fmt(change), '(' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)']) {
      const span = document.createElement('span'); span.textContent = text; quote.appendChild(span);
    }
    if (hovered) {
      const d = new Date(bar.time * 1000), time = document.createElement('span');
      time.className = 'time'; time.textContent = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      quote.appendChild(time);
    }
    renderStudyReadout(index);
  }
  const studyRows = {};
  const studyChartNode = document.getElementById('chart');
  const sessionLayer = document.getElementById('session-layer');
  const paneReadout = document.getElementById('pane-readout');
  if (studyChartNode && sessionLayer) studyChartNode.appendChild(sessionLayer);
  if (studyChartNode && paneReadout) studyChartNode.appendChild(paneReadout);
  const studyLegend = document.getElementById('study-legend');
  if (studyLegend && indicators.includes('ST')) {
    const row = document.createElement('div');
    row.className = 'study-row';
    row.id = 'study-supertrend';
    row.textContent = 'Supertrend (10, 3)';
    studyLegend.appendChild(row);
  }
  if (studyLegend && indicators.includes('SESSION')) {
    const row = document.createElement('div');
    row.className = 'study-row';
    row.id = 'study-sessions';
    if (!intradaySessions) {
      row.style.color = MUTED;
      row.textContent = 'Trading sessions show on intraday charts';
    } else {
      const utc = document.createElement('span');
      utc.style.color = MUTED;
      utc.textContent = 'UTC';
      row.appendChild(utc);
      for (let i = 0; i < TRADING_SESSIONS.length; i++) {
        const session = TRADING_SESSIONS[i];
        const chip = document.createElement('span');
        chip.dataset.session = session.id;
        const swatch = document.createElement('i');
        swatch.style.background = session.swatch;
        chip.appendChild(swatch);
        chip.appendChild(document.createTextNode(session.name));
        row.appendChild(chip);
      }
    }
    studyLegend.appendChild(row);
  }
  const studyPaneName = { macd: 'MACD', rsi: 'RSI (14)', atr: 'ATR (14)' };
  for (let i = 0; i < studyPane.panes.length; i++) {
    const id = studyPane.panes[i];
    const row = document.createElement('div');
    row.className = 'pane-readout';
    const name = document.createElement('b');
    name.textContent = studyPaneName[id] || id;
    const value = document.createElement('span');
    row.appendChild(name);
    row.appendChild(value);
    if (paneReadout) paneReadout.appendChild(row);
    studyRows[id] = value;
    studyRows[id + 'Row'] = row;
  }
  function fmtDigits(n, digits) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function renderStudyReadout(index) {
    const bar = candles[index];
    const time = bar ? bar.time : null;
    const data = studies();
    const stEl = document.getElementById('study-supertrend');
    if (stEl && data.st) {
      const v = time == null ? null : data.stValue.get(time);
      const direction = time == null ? null : data.stTrend.get(time);
      if (v == null) { stEl.style.color = TEXT; stEl.textContent = 'Supertrend (10, 3)'; }
      else { stEl.style.color = direction === 1 ? UP : DOWN; stEl.textContent = 'Supertrend ' + fmt(v); }
    }
    if (intradaySessions && indicators.includes('SESSION')) {
      const active = time == null ? [] : sessionsAt(time);
      const chips = document.querySelectorAll('#study-sessions [data-session]');
      for (let i = 0; i < chips.length; i++) chips[i].classList.toggle('off', active.indexOf(chips[i].dataset.session) < 0);
    }
    if (studyRows.rsi) {
      const v = time == null ? null : data.rsiMap.get(time);
      studyRows.rsi.style.color = '#7E57C2';
      studyRows.rsi.textContent = v == null ? '' : fmtDigits(v, 2);
    }
    if (studyRows.atr) {
      const v = time == null ? null : data.atrMap.get(time);
      studyRows.atr.style.color = '#00897B';
      studyRows.atr.textContent = v == null ? '' : fmt(v);
    }
    if (studyRows.macd) {
      const macd = time == null ? null : data.macdMap.get(time);
      const signal = time == null ? null : data.signalMap.get(time);
      const hist = time == null ? null : data.histMap.get(time);
      const span = studyRows.macd;
      while (span.firstChild) span.removeChild(span.firstChild);
      if (macd != null) {
        const add = (text, color) => { const node = document.createElement('span'); node.style.color = color; node.textContent = text; span.appendChild(node); };
        add(fmt(macd), '#2962FF');
        add(' Signal ' + fmt(signal), '#F7A21B');
        add(' Hist ' + fmt(hist), hist >= 0 ? UP : DOWN);
      }
    }
  }
  function paintSessionBands(layer, width, height) {
    const studySvgNs = 'http://www.w3.org/2000/svg';
    let half = 4;
    const spacing = chart.timeScale().options().barSpacing;
    if (typeof spacing === 'number' && spacing > 0) half = spacing / 2;
    for (let s = 0; s < TRADING_SESSIONS.length; s++) {
      const session = TRADING_SESSIONS[s];
      let runStart = -1;
      const flush = (end) => {
        if (runStart < 0) return;
        const start = runStart;
        runStart = -1;
        const a = chart.timeScale().logicalToCoordinate(start);
        const b = chart.timeScale().logicalToCoordinate(end);
        if (a == null || b == null) return;
        const x = Math.min(a, b) - half;
        const w = Math.abs(b - a) + half * 2;
        if (w <= 0 || x > width || x + w < 0) return;
        const rect = document.createElementNS(studySvgNs, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', '0');
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(height));
        rect.setAttribute('fill', session.fill);
        layer.appendChild(rect);
      };
      for (let i = 0; i < candles.length; i++) {
        const hour = new Date(candles[i].time * 1000).getUTCHours();
        const on = inSession(hour, session.start, session.end);
        if (on && runStart < 0) runStart = i;
        else if (!on && runStart >= 0) flush(i - 1);
      }
      if (runStart >= 0) flush(candles.length - 1);
    }
  }
  window.repaintSessions = function () {
    if (!sessionLayer || !studyChartNode) return;
    const width = chart.timeScale().width() || studyChartNode.clientWidth || 0;
    const axisH = chart.timeScale().height() || 0;
    const plotH = Math.max(0, (studyChartNode.clientHeight || 0) - axisH);
    sessionLayer.setAttribute('width', String(width));
    sessionLayer.setAttribute('height', String(plotH));
    sessionLayer.setAttribute('viewBox', '0 0 ' + width + ' ' + plotH);
    while (sessionLayer.firstChild) sessionLayer.removeChild(sessionLayer.firstChild);
    const shadeBottom = plotH * (1 - (studyPane.oscShare || 0));
    if (indicators.includes('SESSION') && intradaySessions && width > 0 && shadeBottom > 0) paintSessionBands(sessionLayer, width, shadeBottom);
    const studySvgNs = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < studyPane.panes.length; i++) {
      const id = studyPane.panes[i];
      const top = studyPane.margins[id] && studyPane.margins[id].top;
      if (top == null) continue;
      const y = plotH * top;
      const separator = document.createElementNS(studySvgNs, 'line');
      separator.setAttribute('x1', '0');
      separator.setAttribute('x2', String(width));
      separator.setAttribute('y1', String(y));
      separator.setAttribute('y2', String(y));
      separator.setAttribute('stroke', ${JSON.stringify(theme.chartGrid)});
      separator.setAttribute('stroke-width', '1');
      sessionLayer.appendChild(separator);
      const row = studyRows[id + 'Row'];
      if (row) row.style.top = Math.round(y + 3) + 'px';
    }
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(function () { window.repaintSessions(); });
  window.renderLatestLegend = () => renderLegend(candles.length - 1, false);
  window.renderLatestLegend();
  chart.subscribeCrosshairMove(param => {
    const index = param.time ? candles.findIndex(c => c.time === param.time) : -1;
    if (!param.point || index < 0) { window.renderLatestLegend(); return; }
    renderLegend(index, true);
  });

  // Countdown to the next candle on the last-price label (intraday timeframes only).
  function updateCountdown() {
    const latest = candles[candles.length - 1];
    if (!priceLine || !latest || !timeframeSeconds) return;
    const left = Math.max(0, Math.floor(latest.time + timeframeSeconds - Date.now() / 1000));
    const h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), sec = left % 60;
    const pad = n => String(n).padStart(2, '0');
    priceLine.applyOptions({ title: left > 0 ? (h ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec)) : '' });
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);

  // Buy and sell fills. Each mark sits on the candle that was open at the fill, with the fill price.
  let tradeFills = ${JSON.stringify(options.trades ?? []).replace(/</g, '\\u003c')};
  function tradeCandleTime(unix) {
    if (!candles.length || !Number.isFinite(unix)) return null;
    let chosen = null;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].time <= unix) chosen = candles[i].time;
      else break;
    }
    return chosen;
  }
  function applyTradeMarks() {
    if (!series || typeof series.setMarkers !== 'function') return;
    const grouped = new Map();
    const ordered = tradeFills.slice().sort(function(a, b) { return a.time - b.time; });
    for (let i = 0; i < ordered.length; i++) {
      const fill = ordered[i];
      if (!fill || (fill.side !== 'BUY' && fill.side !== 'SELL')) continue;
      const time = tradeCandleTime(Number(fill.time));
      if (time == null) continue;
      const key = time + ':' + fill.side;
      const existing = grouped.get(key);
      if (existing) { existing.count += 1; existing.price = Number(fill.price); }
      else grouped.set(key, { time: time, side: fill.side, price: Number(fill.price), count: 1 });
    }
    const markers = [];
    grouped.forEach(function(fill) {
      const buy = fill.side === 'BUY';
      const digits = typeof pricePrecision === 'number' ? pricePrecision : 2;
      const priceText = Number.isFinite(fill.price)
        ? ' ' + fill.price.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) })
        : '';
      markers.push({
        time: fill.time,
        position: buy ? 'belowBar' : 'aboveBar',
        color: buy ? UP : DOWN,
        shape: buy ? 'arrowUp' : 'arrowDown',
        text: (buy ? 'Buy' : 'Sell') + (fill.count > 1 ? ' ×' + fill.count : '') + priceText,
      });
    });
    markers.sort(function(a, b) { return a.time - b.time; });
    try { series.setMarkers(markers); } catch (_) {}
  }
  window.applyTradeMarks = applyTradeMarks;
  window.updateTrades = function(next) {
    tradeFills = Array.isArray(next) ? next : [];
    applyTradeMarks();
  };
  function receiveTrades(event) {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type === 'chart-trades') window.updateTrades(data.trades);
    } catch (_) {}
  }
  window.addEventListener('message', receiveTrades);
  document.addEventListener('message', receiveTrades);
  applyTradeMarks();

  // Drawing commands from the app (tool picked in the drawing sheet, undo, redo, hide, clear).
  function receiveCommand(event) {
    try { const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type !== 'market-candles' && data.type !== 'chart-trades' && typeof window.chartDrawingCommand === 'function') window.chartDrawingCommand(data);
    } catch (_) {}
  }
  window.addEventListener('message', receiveCommand);
  document.addEventListener('message', receiveCommand);

  function resize() {
    const h = window.innerHeight;
    const w = window.innerWidth;
    chart.applyOptions({ width: w, height: h });
    if (!openedOnMovingCandle) zoomToMovingCandle();
    if (typeof window.repaintSessions === 'function') window.repaintSessions();
  }
  new ResizeObserver(resize).observe(document.body);
  try { resize(); } catch (err) {
    window.dispatchEvent(new ErrorEvent('error', { message: String(err && err.message || err) }));
  }
  ${liveChartScript}
  ${drawingToolsScript}
</script>
</body>
</html>`;
}
