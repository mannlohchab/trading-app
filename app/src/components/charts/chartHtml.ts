import { liveChartScript } from './chartLive';
import { drawingToolsCss, drawingToolsHtml, drawingToolsScript, type ChartDrawing } from './chartDrawingTools';

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Opening window: the latest candle, the one still updating, sits just inside the right edge. */
export function movingCandleRange(count: number, width: number) {
  const slots = Math.min(12, Math.max(6, Math.round(Math.max(width, 280) / 48)));
  const last = Math.max(0, count - 1);
  return { from: last - (slots - 1), to: last + 1 };
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
  options: { exchange?: string; timeframe?: string } = {},
) {
  const timeframe = options.timeframe ?? '';
  const timeframeSeconds = ({ '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400 } as Record<string, number>)[timeframe] ?? 0;
  const legendTitle = [symbol, timeframe, options.exchange].filter(Boolean).join(' · ');
  const data = JSON.stringify(candles);
  pricePrecision = Math.max(0, Math.min(12, pricePrecision));
  const inds = JSON.stringify(indicators);
  const showVolume = indicators.includes('VOL') || indicators.includes('RSI') || indicators.includes('MACD');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html,body,#wrap{margin:0;padding:0;height:100%;background:#FFFFFF;overflow:hidden;font-family:Georgia,"Times New Roman",serif;}
  #chart{height:${showVolume ? '78%' : '100%'};}
  #vol{height:${showVolume ? '22%' : '0'};display:${showVolume ? 'block' : 'none'};}
  #legend{position:absolute;left:12px;top:8px;z-index:6;pointer-events:none;line-height:1.35;}
  #legend .title{font-size:13px;color:#16181D;letter-spacing:.1px;}
  #legend .quote{font-size:15px;margin-top:2px;font-variant-numeric:tabular-nums;}
  #legend .quote span{margin-right:8px;}
  #legend .time{font-size:11px;color:#9A9FB0;}
  #vol-label{position:absolute;left:12px;z-index:6;font-size:12px;color:#6B7185;pointer-events:none;}
  /* The app toolbar's pen button opens the drawing menu; keep the in-chart toggle for keyboard/tests only. */
  #tools-toggle{position:absolute!important;width:1px!important;height:1px!important;min-height:0!important;padding:0!important;overflow:hidden;opacity:0;pointer-events:none;}
  #drawing-ui{top:58px!important;}
${drawingToolsCss}
</style>
<script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
<div id="wrap">
  <div id="chart"></div>
  <div id="vol"></div>
  <div id="legend" aria-live="off"><div class="title"></div><div class="quote"></div></div>
  <div id="vol-label">Volume</div>
  ${drawingToolsHtml}
</div>
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
  const initialDrawings = ${JSON.stringify(initialDrawings)};
  const drawingKey = ${JSON.stringify(drawingKey).replace(/</g, '\\u003c')};
  const grid = '#F0F1F7';
  const UP = '#089981', DOWN = '#F23645';
  const UP_VOL = 'rgba(8,153,129,0.45)', DOWN_VOL = 'rgba(242,54,69,0.45)';
  const legendTitle = ${JSON.stringify(legendTitle).replace(/</g, '\\u003c')};
  const timeframeSeconds = ${timeframeSeconds};
  const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: { background: { color: '#FFFFFF' }, textColor: '#6B7185', fontFamily: 'Georgia, Times New Roman, serif', fontSize: 12 },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: '#E3E6F0', scaleMargins: { top: 0.16, bottom: 0.06 } },
    timeScale: { borderColor: '#E3E6F0', timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#9A9FB0', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#F7F7FC' },
      horzLine: { color: '#9A9FB0', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#F7F7FC' },
    },
    localization: { priceFormatter: p => Number(p).toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision }) },
    handleScroll: true,
    handleScale: true,
  });

  let volChart = null;
  if (showVolume) {
    volChart = LightweightCharts.createChart(document.getElementById('vol'), {
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: '#E3E6F0', scaleMargins: { top: 0.2, bottom: 0 } },
      timeScale: { visible: false },
      // The main pane keeps the TradingView attribution; one logo is enough.
      layout: { background: { color: '#FFFFFF' }, textColor: '#6B7185', fontFamily: 'Georgia, Times New Roman, serif', fontSize: 12, attributionLogo: false },
    });
  }

  let series;
  if (chartType === 'line') {
    series = chart.addLineSeries({ color: '#0066FF', lineWidth: 2, priceLineVisible: false });
    series.setData(candles.map(c => ({ time: c.time, value: c.close })));
  } else if (chartType === 'area') {
    series = chart.addAreaSeries({
      lineColor: '#0066FF', topColor: 'rgba(0,102,255,0.24)', bottomColor: 'rgba(0,102,255,0.02)',
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

  if (volChart) {
    const vol = volumeSeries = volChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceLineVisible: false });
    vol.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? UP_VOL : DOWN_VOL,
    })));
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
    addIndicator('#B98428', () => sma(20));
  }
  if (indicators.includes('EMA')) {
    addIndicator('#0066FF', () => ema(20));
  }
  if (indicators.includes('BB')) {
    addIndicator('#94A3B8', () => bollinger().mid);
    addIndicator('#64748B', () => bollinger().upper);
    addIndicator('#64748B', () => bollinger().lower);
  }

  if (volChart) {
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) volChart.timeScale().setVisibleLogicalRange(range);
    });
  }
  const movingCandleRange = ${movingCandleRange.toString()};
  let openedOnMovingCandle = false;
  function zoomToMovingCandle() {
    const width = Math.max(chart.timeScale().width() || 0, window.innerWidth || 0);
    if (width < 40 || !candles.length) return;
    chart.timeScale().setVisibleLogicalRange(movingCandleRange(candles.length, width));
    openedOnMovingCandle = true;
  }

  // TradingView-style legend: latest bar by default, hovered bar while the crosshair is active.
  const legend = document.getElementById('legend');
  legend.querySelector('.title').textContent = legendTitle;
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
  }
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

  // The native toolbar's pen button opens the in-chart drawing menu.
  function receiveCommand(event) {
    try { const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type === 'open-drawing-tools') document.getElementById('tools-toggle').click();
    } catch (_) {}
  }
  window.addEventListener('message', receiveCommand);
  document.addEventListener('message', receiveCommand);

  function resize() {
    const h = window.innerHeight;
    const w = window.innerWidth;
    chart.applyOptions({ width: w, height: showVolume ? h * 0.78 : h });
    if (volChart) volChart.applyOptions({ width: w, height: h * 0.22 });
    document.getElementById('vol-label').style.display = showVolume ? 'block' : 'none';
    document.getElementById('vol-label').style.top = (h * 0.78 + 6) + 'px';
    if (!openedOnMovingCandle) zoomToMovingCandle();
  }
  new ResizeObserver(resize).observe(document.body);
  resize();
  ${liveChartScript}
  ${drawingToolsScript}
</script>
</body>
</html>`;
}
