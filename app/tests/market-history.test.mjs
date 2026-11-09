import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHistoryChart, buildWatchlistChart, watchlistLineSegments } from '../src/lib/marketHistory.ts';

const candle = (date, close) => ({ time: Date.parse(date) / 1000, close });

test('draws only the latest available hour, sorted by actual timestamps', () => {
  const chart = buildHistoryChart({ isDemo: false, candles: [
    candle('2026-10-29T20:55:00Z', 200),
    candle('2026-10-30T08:30:00Z', 999),
    candle('2026-10-30T08:25:00Z', 999),
    candle('2026-10-30T09:30:00Z', 105),
    candle('2026-10-30T09:15:00Z', 100),
    candle('2026-10-30T09:20:00Z', 110),
    { time: NaN, close: 300 },
    candle('2026-10-30T09:25:00Z', NaN),
  ] });
  assert.equal(chart.points.length, 3);
  assert.equal(chart.peak.value, 110);
  assert.equal(chart.sessionDate, '2026-10-30');
  assert.ok(Math.abs(chart.points[1].x - (3 + 154 / 3)) < 1e-10);
  assert.equal(chart.positive, true);
});

test('never draws demo history or a made-up line for missing data', () => {
  const candles = [candle('2026-10-30T09:15:00Z', 100), candle('2026-10-30T09:20:00Z', 110)];
  assert.equal(buildHistoryChart({ isDemo: true, candles }), null);
  assert.equal(buildHistoryChart({ candles }), null);
  assert.equal(buildHistoryChart({ isDemo: false, candles: [] }), null);
  assert.equal(buildHistoryChart({ isDemo: false, candles: candles.slice(0, 1) }), null);
});

test('flat prices stay centered and duplicate timestamps do not add invented points', () => {
  const chart = buildHistoryChart({ isDemo: false, candles: [
    candle('2026-10-30T09:15:00Z', 100),
    candle('2026-10-30T09:15:00Z', 100),
    candle('2026-10-30T09:20:00Z', 100),
  ] });
  assert.equal(chart.points.length, 2);
  assert.equal(chart.points[0].y, chart.points[1].y);
  assert.equal(chart.points[0].y, 59);
  assert.ok(!chart.path.includes('NaN'));
});

test('watchlist stays empty without timestamped history', () => {
  assert.equal(buildWatchlistChart(undefined), null);
});

test('watchlist labels the hour and demo history requires preview opt-in', () => {
  const history = { isDemo: false, candles: [candle('2026-10-30T09:15:00Z', 200), candle('2026-10-30T09:20:00Z', 190)] };
  assert.equal(buildWatchlistChart(history).peak.value, 200);
  assert.match(buildWatchlistChart(history).caption, /1H/);
  const demo = { ...history, isDemo: true };
  assert.equal(buildWatchlistChart(demo), null);
  assert.match(buildWatchlistChart(demo, true).caption, /Demo.*1H/);
});

test('a full day of five-minute candles produces only twelve mini-chart points', () => {
  const start = Date.parse('2026-10-30T00:00:00Z') / 1000;
  const chart = buildHistoryChart({ isDemo: false, source: 'binance', candles:
    Array.from({ length: 288 }, (_, i) => ({ time: start + i * 300, close: 100 + i })),
  });
  assert.equal(chart.points.length, 12);
  assert.equal(chart.points[0].value, 376);
  assert.equal(chart.points.at(-1).value, 387);
  assert.equal(watchlistLineSegments(chart.points, 160).length, 11);
});

test('a gap longer than an hour does not connect older observations', () => {
  assert.equal(buildHistoryChart({ isDemo: false, candles: [
    candle('2026-10-30T08:00:00Z', 100), candle('2026-10-30T09:20:00Z', 110),
  ] }), null);
});

test('native watchlist line segments meet at exact endpoints at different card widths', () => {
  const chart = buildWatchlistChart({ isDemo: false, candles: [100, 110, 95, 105].map((close, i) => ({ time: 100000 + i * 300, close })) });
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
