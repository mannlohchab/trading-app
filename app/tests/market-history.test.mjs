import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHistoryChart, buildWatchlistChart, watchlistLineSegments } from '../src/lib/marketHistory.ts';

const candle = (date, close) => ({ time: Date.parse(date) / 1000, close });

test('draws only the latest Indian trading session, sorted by actual timestamps', () => {
  const chart = buildHistoryChart({ isDemo: false, candles: [
    candle('2026-10-29T15:25:00+05:30', 200),
    candle('2026-10-30T09:30:00+05:30', 105),
    candle('2026-10-30T09:15:00+05:30', 100),
    candle('2026-10-30T09:20:00+05:30', 110),
    { time: NaN, close: 300 },
    candle('2026-10-30T09:25:00+05:30', NaN),
  ] });
  assert.equal(chart.points.length, 3);
  assert.equal(chart.peak.value, 110);
  assert.equal(chart.sessionDate, '2026-10-30');
  assert.ok(Math.abs(chart.points[1].x - (3 + 154 / 3)) < 1e-10);
  assert.equal(chart.positive, true);
});

test('never draws demo history or a made-up line for missing data', () => {
  const candles = [candle('2026-10-30T09:15:00+05:30', 100), candle('2026-10-30T09:20:00+05:30', 110)];
  assert.equal(buildHistoryChart({ isDemo: true, candles }), null);
  assert.equal(buildHistoryChart({ candles }), null);
  assert.equal(buildHistoryChart({ isDemo: false, candles: [] }), null);
  assert.equal(buildHistoryChart({ isDemo: false, candles: candles.slice(0, 1) }), null);
});

test('flat prices stay centered and duplicate timestamps do not add invented points', () => {
  const chart = buildHistoryChart({ isDemo: false, candles: [
    candle('2026-10-30T09:15:00+05:30', 100),
    candle('2026-10-30T09:15:00+05:30', 100),
    candle('2026-10-30T09:20:00+05:30', 100),
  ] });
  assert.equal(chart.points.length, 2);
  assert.equal(chart.points[0].y, chart.points[1].y);
  assert.equal(chart.points[0].y, 59);
  assert.ok(!chart.path.includes('NaN'));
});

test('watchlist uses the quote series immediately when detailed history is absent', () => {
  const chart = buildWatchlistChart(undefined, { source: 'yahoo', sparkline: [100, 112, 104, 109] });
  assert.deepEqual(chart.points.map(point => point.value), [100, 112, 104, 109]);
  assert.equal(chart.peak.value, 112);
  assert.equal(chart.caption, 'Recent prices');
  assert.equal(chart.positive, true);
});

test('watchlist prefers dated history, and demo quote series require preview opt-in', () => {
  const history = { isDemo: false, candles: [candle('2026-10-30T09:15:00+05:30', 200), candle('2026-10-30T09:20:00+05:30', 190)] };
  const sample = { source: 'demo', sparkline: [50, 60] };
  assert.equal(buildWatchlistChart(undefined, sample), null);
  assert.equal(buildWatchlistChart(undefined, sample, true).caption, 'Demo prices');
  assert.equal(buildWatchlistChart(history, sample).peak.value, 200);
  assert.match(buildWatchlistChart(history, sample).caption, /2026-10-30/);
  assert.equal(buildWatchlistChart(undefined, { sparkline: [10, 20] }), null);
  assert.equal(buildWatchlistChart(undefined, { source: 'yahoo', sparkline: [10, NaN] }), null);
  const flat = buildWatchlistChart(undefined, { source: 'angelone', sparkline: [25, 25] });
  assert.ok(flat.points.every(point => Number.isFinite(point.y)));
});

test('native watchlist line segments meet at exact endpoints at different card widths', () => {
  const chart = buildWatchlistChart(undefined, { source: 'yahoo', sparkline: [100, 110, 95, 105] });
  for (const width of [118, 160, 176]) {
    const segments = watchlistLineSegments(chart.points, width);
    assert.equal(segments.length, chart.points.length - 1);
    segments.forEach((segment, i) => {
      const centerX = segment.left + segment.width / 2;
      const centerY = segment.top + 0.9;
      const halfX = Math.cos(segment.angle) * segment.width / 2;
      const halfY = Math.sin(segment.angle) * segment.width / 2;
      assert.ok(Math.abs(centerX - halfX - chart.points[i].x / 160 * width) < 1e-8);
      assert.ok(Math.abs(centerY - halfY - chart.points[i].y) < 1e-8);
      assert.ok(Math.abs(centerX + halfX - chart.points[i + 1].x / 160 * width) < 1e-8);
      assert.ok(Math.abs(centerY + halfY - chart.points[i + 1].y) < 1e-8);
    });
  }
});
