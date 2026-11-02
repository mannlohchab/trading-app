import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPreviewChart, nearestChartPoint, previewLineSegments } from '../src/lib/stockPreview.ts';

const candle = (date, close) => ({ time: Date.parse(date) / 1000, close });
const candles = [
  candle('2026-10-29T09:15:00Z', 90),
  candle('2026-10-30T09:15:00Z', 100),
  candle('2026-10-30T09:20:00Z', 110),
  candle('2026-10-30T09:30:00Z', 105),
];

test('1D selects the latest real session and preserves gaps between observation times', () => {
  const chart = buildPreviewChart({ isDemo: false, candles }, '1D');
  assert.equal(chart.points.length, 3);
  assert.equal(chart.points[0].value, 100);
  assert.ok(Math.abs(chart.points[1].x - 100 / 3) < 1e-9);
  assert.equal(nearestChartPoint(chart.points, 30).value, 110);
  assert.equal(nearestChartPoint(chart.points, 98).value, 105);
});

test('longer ranges include previous sessions without fabricating missing prices', () => {
  const chart = buildPreviewChart({ isDemo: false, source: 'twelvedata', candles }, '7D');
  assert.deepEqual(chart.points.map(p => p.value), [90, 100, 110, 105]);
  assert.equal(chart.start, candles[0].time);
  assert.equal(chart.end, candles[3].time);
});

test('invalid, duplicate, missing and demo data cannot create a misleading chart', () => {
  assert.equal(buildPreviewChart({ isDemo: true, candles }, '1D'), null);
  assert.equal(buildPreviewChart({ candles }, '1D'), null);
  assert.equal(buildPreviewChart({ isDemo: false, candles: [candles[0]] }, '1D'), null);
  const chart = buildPreviewChart({ isDemo: false, candles: [
    ...candles.slice(1), candles[1], { time: Infinity, close: 22 }, { time: 8e12, close: 22 },
    { time: candles[1].time + 5, close: -20 },
  ] }, '1D');
  assert.equal(chart.points.length, 3);
  assert.ok(chart.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('flat history has finite bounds and centered prices', () => {
  const chart = buildPreviewChart({ isDemo: false, candles: candles.map(c => ({ ...c, close: 100 })) }, '7D');
  assert.ok(chart.max > chart.min);
  assert.ok(chart.points.every(p => p.y === 50));
});

test('detail chart renders connected native segments at measured widths without distorting time gaps', () => {
  const chart = buildPreviewChart({ isDemo: false, candles }, '1D');
  for (const width of [190, 280, 480]) {
    const segments = previewLineSegments(chart.points, width, 210);
    assert.equal(segments.length, chart.points.length - 1);
    segments.forEach((s, i) => {
      const cx = s.left + s.width / 2, cy = s.top + 1;
      const dx = Math.cos(s.angle) * s.width / 2, dy = Math.sin(s.angle) * s.width / 2;
      assert.ok(Math.abs(cx - dx - chart.points[i].x / 100 * width) < 1e-8);
      assert.ok(Math.abs(cy - dy - chart.points[i].y / 100 * 210) < 1e-8);
      assert.ok(Math.abs(cx + dx - chart.points[i + 1].x / 100 * width) < 1e-8);
      assert.ok(Math.abs(cy + dy - chart.points[i + 1].y / 100 * 210) < 1e-8);
    });
  }
});
