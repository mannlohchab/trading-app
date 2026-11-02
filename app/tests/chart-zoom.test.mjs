import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChartHtml, movingCandleRange } from '../src/components/charts/chartHtml.ts';

const candle = (time) => ({ time, open: 1, high: 1.1, low: 0.9, close: 1, volume: 1 });

test('opening range frames the latest candle instead of the whole history', () => {
  const phone = movingCandleRange(300, 390);
  assert.deepEqual(phone, { from: 292, to: 300 });
  const desktop = movingCandleRange(300, 1400);
  assert.deepEqual(desktop, { from: 288, to: 300 });
  assert.deepEqual(movingCandleRange(1, 800), { from: -11, to: 1 });
});

test('chart document applies that range once it has a width and does not fit every bar', () => {
  const html = buildChartHtml(Array.from({ length: 40 }, (_, time) => candle(time)), 'candle', [], 'EUR/USD');
  assert.equal(html.includes('fitContent'), false);
  const start = html.indexOf('const movingCandleRange = ');
  const end = html.indexOf('let openedOnMovingCandle');
  const source = html.slice(start + 'const movingCandleRange = '.length, end).trim().replace(/;$/, '');
  const embedded = new Function(`return ${source}`)();
  assert.deepEqual(embedded(40, 390), movingCandleRange(40, 390));
  assert.match(html, /zoomToMovingCandle\(\)/);
});
