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
) {
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
  html,body,#wrap{margin:0;padding:0;height:100%;background:#fff;overflow:hidden;font-family:system-ui,sans-serif;}
  #chart{height:${showVolume ? '78%' : '100%'};}
  #vol{height:${showVolume ? '22%' : '0'};display:${showVolume ? 'block' : 'none'};}
  #tip{
    position:absolute;display:none;pointer-events:none;z-index:5;
    background:#fff;color:#1E293B;border:1px solid #BCD3FF;border-radius:10px;padding:8px 12px;
    font-size:12px;line-height:1.25;min-width:72px;text-align:left;
    box-shadow:0 2px 8px rgba(0,66,173,.12);
  }
  #tip b{font-weight:700;}
  #tip.down{border-color:#F2CCD6;}
${drawingToolsCss}
</style>
<script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
<div id="wrap">
  <div id="chart"></div>
  <div id="vol"></div>
  <div id="tip"></div>
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
  const grid = '#F0EDF6';
  const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: { background: { color: '#FFFFFF' }, textColor: '#64748b', fontSize: 12 },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: '#E2E8F0', scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: '#E2E8F0', timeVisible: true, secondsVisible: false },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#94A3B8', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#0066FF' },
      horzLine: { color: '#94A3B8', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#0066FF' },
    },
    handleScroll: true,
    handleScale: true,
  });

  let volChart = null;
  if (showVolume) {
    volChart = LightweightCharts.createChart(document.getElementById('vol'), {
      layout: { background: { color: '#FFFFFF' }, textColor: '#64748b' },
      grid: { vertLines: { visible: false }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: '#E2E8F0' },
      timeScale: { visible: false },
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
      upColor: '#0EA57A', downColor: '#E45D80',
      borderUpColor: '#0EA57A', borderDownColor: '#E45D80',
      wickUpColor: '#0EA57A', wickDownColor: '#E45D80',
      priceLineVisible: false,
    });
    series.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  }

  series.applyOptions({priceFormat});
  let priceLine = null;
  const last = candles[candles.length - 1];
  if (last) {
    const up = last.close >= last.open;
    priceLine = series.createPriceLine({
      price: last.close,
      color: up ? '#0EA57A' : '#E45D80',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: '',
    });
  }

  if (volChart) {
    const vol = volumeSeries = volChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
    vol.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? 'rgba(14,165,122,0.28)' : 'rgba(228,93,128,0.28)',
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

  const tip = document.getElementById('tip');
  chart.subscribeCrosshairMove(param => {
    if (!param.point || !param.time || !param.seriesData) {
      tip.style.display = 'none';
      return;
    }
    const bar = param.seriesData.get(series);
    const price = bar && (bar.close ?? bar.value);
    if (price == null) { tip.style.display = 'none'; return; }
    const d = new Date(Number(param.time) * 1000);
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const down = bar.open != null && bar.close < bar.open;
    tip.className = down ? 'down' : '';
    tip.textContent = symbol + ' ' + Number(price).toFixed(pricePrecision) + ' ' + currency + ' · ' + hh + ':' + mm;
    tip.style.display = 'block';
    tip.style.top = Math.max(8, param.point.y - 18) + 'px';
    tip.style.left = Math.min(window.innerWidth - 120, Math.max(8, param.point.x + 12)) + 'px';
  });

  function resize() {
    const h = window.innerHeight;
    const w = window.innerWidth;
    chart.applyOptions({ width: w, height: showVolume ? h * 0.78 : h });
    if (volChart) volChart.applyOptions({ width: w, height: h * 0.22 });
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
