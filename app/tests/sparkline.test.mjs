import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSparkline } from '../src/lib/sparkline.ts';

test('price line keeps observed rises and pullbacks within its plot bounds', () => {
  const chart = buildSparkline([100, 112, 105, 108, 97, 103], 64, 36);
  assert.equal(chart.points.length, 6);
  assert.ok(chart.points[1].y < chart.points[0].y);
  assert.ok(chart.points[2].y > chart.points[1].y);
  assert.ok(chart.points.every(p => p.x >= 3 && p.x <= 61 && p.y >= 3 && p.y <= 33));
  assert.equal(chart.baseline, chart.points[0].y);
  assert.equal(chart.last.value, 103);
});

test('rotated line segments join exactly at each observation on narrow and wide rows', () => {
  for (const width of [48, 64, 90]) {
    const chart = buildSparkline([200, 195, 198, 190], width, 36);
    chart.segments.forEach((s, i) => {
      const cx = s.left + s.width / 2, cy = s.top + 0.9;
      const dx = Math.cos(s.angle) * s.width / 2, dy = Math.sin(s.angle) * s.width / 2;
      assert.ok(Math.abs(cx - dx - chart.points[i].x) < 1e-8);
      assert.ok(Math.abs(cy - dy - chart.points[i].y) < 1e-8);
      assert.ok(Math.abs(cx + dx - chart.points[i + 1].x) < 1e-8);
      assert.ok(Math.abs(cy + dy - chart.points[i + 1].y) < 1e-8);
    });
  }
});

test('flat data stays centered and invalid or missing data never invents a graph', () => {
  const flat = buildSparkline([25, 25, 25], 64, 36);
  assert.ok(flat.points.every(p => p.y === 18));
  for (const values of [[], [10], [10, NaN], [10, Infinity], [0, 10], [-10, 10]]) {
    assert.equal(buildSparkline(values, 64, 36), null);
  }
  assert.equal(buildSparkline([10, 20], 0, 36), null);
});

test('candle charts preserve real time gaps instead of equally spacing observations', () => {
  const chart = buildSparkline([100, 110, 105], 66, 36, [1000, 1300, 2200]);
  assert.equal(chart.points[0].x, 3);
  assert.equal(chart.points[1].x, 18);
  assert.equal(chart.points[2].x, 63);
  assert.equal(buildSparkline([100, 110], 66, 36, [1000, 1000]), null);
  assert.equal(buildSparkline([100, 110], 66, 36, [1000]), null);
  assert.equal(buildSparkline([100, 110], 66, 36, [1300, 1000]), null);
});
