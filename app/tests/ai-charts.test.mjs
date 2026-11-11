import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartsFromBlocks, layoutChart, lineSegments, parseChartBlock } from '../src/lib/aiCharts.ts';

const block = (data = {}) => ({
  type: 'chart',
  data: {
    exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '4h', chartType: 'candle',
    candles: [[0, 100, 110, 95, 105], [1, 105, 108, 100, 102], [2, 102, 120, 101, 118]],
    lines: [{ id: 'SMA20', label: 'SMA 20', values: [null, 103, 106] }],
    levels: [{ kind: 'resistance', label: 'Resistance', price: 120 }, { kind: 'support', label: 'Support', price: 95 }],
    pricePrecision: 2, lastClose: 118, changePercent: 18,
    ...data,
  },
});

test('reads chart blocks from saved metadata and ignores other cards', () => {
  const charts = chartsFromBlocks([{ type: 'markdown', text: 'hi' }, block(), { type: 'disclaimer', text: '…' }]);
  assert.equal(charts.length, 1);
  assert.equal(charts[0].symbol, 'BTCUSDT');
  assert.deepEqual(charts[0].lines[0].values, [null, 103, 106]);
  assert.deepEqual(chartsFromBlocks(undefined), []);
});

test('drops malformed charts instead of drawing them wrong', () => {
  assert.equal(parseChartBlock(block({ candles: [[0, 1, 2, 0, 1]] })), null, 'needs two candles');
  assert.equal(parseChartBlock(block({ symbol: '' })), null);
  assert.equal(parseChartBlock({ type: 'ticker', data: {} }), null);
  // A bad candle (high below low) or a line of the wrong length is dropped; the rest still draws.
  const chart = parseChartBlock(block({
    candles: [[0, 1, 2, 0.5, 1.5], [1, 1, 0.5, 2, 1], [2, 1.5, 2, 1, 1.8]],
    lines: [{ id: 'SMA20', label: 'SMA 20', values: [1] }],
    levels: [{ kind: 'pivot', label: 'x', price: 1 }],
  }));
  assert.equal(chart.candles.length, 2);
  assert.deepEqual(chart.lines, []);
  assert.deepEqual(chart.levels, []);
});

test('layout fits candles, lines and levels inside the plot', () => {
  const chart = parseChartBlock(block());
  const layout = layoutChart(chart, 300, 150);
  const ys = [...layout.candles.flatMap(c => [c.wickTop, c.wickBottom]), ...layout.levels.map(l => l.y)];
  assert.ok(ys.every(y => y > 0 && y < 150));
  assert.ok(layout.levels[0].y < layout.levels[1].y, 'resistance is drawn above support');
  assert.deepEqual(layout.candles.map(c => c.up), [true, false, true]);
  assert.equal(layout.candles[0].x, 50);
  // The null value starts the line late rather than drawing it from zero.
  assert.equal(layout.lines[0].runs.length, 1);
  assert.equal(layout.lines[0].runs[0].length, 2);
});

test('line segments join consecutive points', () => {
  const [segment] = lineSegments([{ x: 0, y: 0 }, { x: 30, y: 40 }]);
  assert.equal(segment.width, 50);
  assert.equal(segment.left, -10);
  assert.equal(segment.top, 19);
});
