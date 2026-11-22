import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script, runInNewContext } from 'node:vm';
import { buildChartHtml } from '../src/components/charts/chartHtml.ts';
import { indicatorMathSource, studyLayout } from '../src/components/charts/chartIndicators.ts';
import { liveChartScript } from '../src/components/charts/chartLive.ts';

const math = {};
runInNewContext(indicatorMathSource, math);

const candle = (time, close, extra = {}) => ({
  time, open: close, high: close, low: close, close, volume: 1, ...extra,
});

test('wilder rsi matches a hand-computed series', () => {
  const closes = [10, 11, 12, 11, 12, 13];
  const candles = closes.map((close, i) => candle(1_700_000_000 + i * 60, close));
  const rsi = math.rsiPoints(candles, 3);
  assert.equal(rsi[2], null);
  assert.ok(Math.abs(rsi[3] - (100 - 100 / 3)) < 1e-9);
  assert.ok(Math.abs(rsi[5] - (100 - 100 / 6.75)) < 1e-9);
  const rising = Array.from({ length: 20 }, (_, i) => candle(i, 100 + i));
  assert.equal(math.rsiPoints(rising, 14).at(-1), 100);
});

test('macd histogram is the line minus the signal, and atr is the true range', () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(1_700_000_000 + i * 60, 100 + i));
  const macd = math.macdPoints(candles, 12, 26, 9);
  const last = macd.macd.length - 1;
  assert.ok(macd.macd[last] > 0);
  assert.ok(Math.abs(macd.histogram[last] - (macd.macd[last] - macd.signal[last])) < 1e-9);
  assert.equal(macd.macd[0], null);
  const flat = Array.from({ length: 20 }, (_, i) => candle(i, 10, { high: 12, low: 10 }));
  const atr = math.atrPoints(flat, 14);
  assert.equal(atr[13], 2);
  assert.ok(Math.abs(atr[19] - 2) < 1e-9);
});

test('supertrend stays under price in a steady rise and above it in a steady fall', () => {
  const up = Array.from({ length: 40 }, (_, i) => candle(1_700_000_000 + i * 3600, 100 + i * 2, { high: 101 + i * 2, low: 99 + i * 2 }));
  const upTrend = math.supertrendPoints(up, 10, 3);
  assert.equal(upTrend.trend.at(-1), 1);
  assert.ok(upTrend.value.at(-1) < up.at(-1).close);
  const down = Array.from({ length: 40 }, (_, i) => candle(1_700_000_000 + i * 3600, 200 - i * 2, { high: 201 - i * 2, low: 199 - i * 2 }));
  const downTrend = math.supertrendPoints(down, 10, 3);
  assert.equal(downTrend.trend.at(-1), -1);
  assert.ok(downTrend.value.at(-1) > down.at(-1).close);
});

test('trading sessions are fixed UTC windows, including the Sydney wrap past midnight', () => {
  const at = (hour) => Date.UTC(2024, 0, 15, hour, 30) / 1000;
  const ids = (hour) => Array.from(math.sessionsAt(at(hour))).sort().join(',');
  assert.equal(ids(13), 'london,newyork');
  assert.equal(ids(22), 'sydney');
  assert.equal(ids(3), 'sydney,tokyo');
  assert.equal(ids(8), 'london,tokyo');
  assert.equal(ids(10), 'london');
  assert.equal(ids(18), 'newyork');
  assert.equal(ids(6), 'tokyo');
  assert.equal(math.inSession(21, 21, 6), true);
  assert.equal(math.inSession(6, 21, 6), false);
});

test('volume on its own keeps the original pane, and oscillators leave room for candles', () => {
  const volume = studyLayout(['VOL']);
  assert.equal(volume.priceBottom, 0.22);
  assert.deepEqual(volume.volumeMargins, { top: 0.8, bottom: 0 });
  assert.deepEqual(studyLayout([]), {
    panes: [], priceTop: 0.16, priceBottom: 0.06, oscShare: 0, volumeMargins: null, margins: {},
  });
  const all = studyLayout(['VOL', 'MACD', 'RSI', 'ATR']);
  assert.deepEqual(all.panes, ['macd', 'rsi', 'atr']);
  assert.ok(1 - all.priceTop - all.priceBottom >= 0.34 - 1e-9);
  for (let i = 0; i < all.panes.length; i++) {
    const pane = all.margins[all.panes[i]];
    assert.ok(pane.top < 1 - pane.bottom);
    const next = all.margins[all.panes[i + 1]];
    if (next) assert.ok(1 - pane.bottom <= next.top + 1e-9);
  }
  assert.ok(1 - all.priceBottom <= all.volumeMargins.top + 1e-6);
  assert.ok(Math.abs((1 - all.volumeMargins.bottom) - all.margins.macd.top) < 1e-6);
});

test('the chart page parses with the new studies and keeps session bands off daily charts', () => {
  const bars = Array.from({ length: 30 }, (_, time) => candle(1_700_000_000 + time * 900, 100 + time));
  const html = buildChartHtml(bars, 'candle', ['VOL', 'RSI', 'MACD', 'ATR', 'ST', 'SESSION'], 'BTCUSDT', [], 'k', 2, 'USD', { timeframe: '15m' });
  assert.equal(html.includes('[bytecode]'), false);
  assert.match(html, /intradaySessions = true/);
  assert.match(html, /repaintSessions/);
  assert.match(html, /id="session-layer"/);
  assert.match(html, /id = 'study-sessions'[\s\S]{0,900}studyLegend\.appendChild\(row\)/);
  assert.match(html, /Supertrend \(10, 3\)/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new Script(script));
  const daily = buildChartHtml(bars, 'candle', ['SESSION'], 'BTCUSDT', [], 'k', 2, 'USD', { timeframe: '1d' });
  assert.match(daily, /intradaySessions = false/);
  const volumeOnly = buildChartHtml([candle(1, 1)], 'candle', ['VOL'], 'BTCUSDT');
  assert.match(volumeOnly, /bottom: 0\.22/);
  assert.match(volumeOnly, /"top":0\.8/);
});

test('a live candle update repaints session bands when the page provides them', () => {
  let painted = 0;
  const context = {
    window: { addEventListener() {}, repaintSessions() { painted += 1; }, renderLatestLegend() {} },
    document: { addEventListener() {} },
    candles: [{ time: 1, close: 10 }], chartType: 'line',
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => null, setVisibleLogicalRange() {} }) },
    series: { setData() {} }, priceLine: { applyOptions() {} }, volumeSeries: null, indicatorSeries: [],
  };
  runInNewContext(liveChartScript, context);
  context.window.updateCandles([{ time: 1, open: 1, close: 2, high: 2, low: 1, volume: 1 }]);
  assert.equal(painted, 1);
});
