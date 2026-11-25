import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonNotes, defaultBacktestDraft, equitySegments, isActiveBacktest, prepareBacktest, prepareRiskStatistics } from '../src/lib/backtesting.ts';
import { parseDatasetDocument, researchInteger, researchObjectiveInfo, researchObjectiveValue } from '../src/lib/backtestResearch.ts';

const strategy = { id: 'strategy-id', versionId: 'immutable-version-id' };
const now = Date.parse('2026-11-23T10:00:00Z');
const prepare = overrides => prepareBacktest({ ...defaultBacktestDraft, ...overrides }, strategy, now);

test('pins the selected strategy version and keeps precise decimal strings', () => {
  const result = prepare({ initialCapital: '10000.000000000001', commissionPercent: '0', start: '2026-10-01', end: '2026-11-01', timeframe: '1h' });
  assert.equal(result.strategyVersionId, strategy.versionId);
  assert.equal(result.settings.initialCapital, '10000.000000000001');
  assert.equal(result.settings.commissionPercent, '0');
  assert.equal(result.range.start, '2026-10-01T00:00:00.000Z');
  assert.equal(result.range.end, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(result.market, { timeframe: '1h' });
});

test('blank dates and timeframe preserve server defaults', () => {
  const result = prepare({});
  assert.equal(result.range, undefined);
  assert.equal(result.market, undefined);
  assert.equal(result.settings.slippageTicks, 1);
});

test('intraday boundaries preserve explicit offsets and reject ambiguous local timestamps', () => {
  const result = prepare({ start: '2026-11-01T09:15:00+05:30', end: '2026-11-01T15:30:00+05:30' });
  assert.equal(result.range.start, '2026-11-01T03:45:00.000Z');
  assert.equal(result.range.end, '2026-11-01T10:00:00.000Z');
  for (const start of ['2026-11-01T09:15:00', '2026-02-30T09:15:00Z', '2026-11-01T24:00:00Z', '2026-11-01T10:60:00Z']) assert.throws(() => prepare({ start }));
});

test('rejects impossible, reversed and future dates rather than rolling them over', () => {
  for (const draft of [{ start: '2026-02-30' }, { start: '2026-13-01' }, { start: '01/02/2026' }, { start: '2026-11-24' }, { end: '2026-11-24' }, { start: '2026-10-02', end: '2026-10-01' }, { start: '2026-10-01', end: '2026-10-01' }]) {
    assert.throws(() => prepare(draft));
  }
});

test('rejects invalid monetary, sizing, slippage and timeframe input', () => {
  for (const draft of [{ initialCapital: 'Infinity' }, { initialCapital: '1e5' }, { initialCapital: '0' }, { commissionPercent: '-1' }, { commissionPercent: '6' }, { sizingValue: '101' }, { sizingValue: '0' }, { slippageTicks: '1.2' }, { slippageTicks: '-1' }, { slippageTicks: '1001' }, { timeframe: '2h' }]) assert.throws(() => prepare(draft));
  assert.equal(prepare({ sizingType: 'fixed_quantity', sizingValue: '500' }).settings.positionSizing.value, '500');
});

test('spread and participation scenarios are explicit and bounded', () => {
  assert.equal(prepare({}).settings.execution, undefined);
  assert.deepEqual(prepare({ spreadTicks: '4', maxVolumeParticipationPercent: '2.5' }).settings.execution, { spreadTicks: 4, maxVolumeParticipationPercent: '2.5' });
  for (const draft of [{ spreadTicks: '-1' }, { spreadTicks: '1.5' }, { maxVolumeParticipationPercent: '0' }, { maxVolumeParticipationPercent: '101' }]) assert.throws(() => prepare(draft));
});

test('annualized statistics require explicit frequency and convert percentage rates once', () => {
  assert.equal(prepareRiskStatistics('', ''), undefined);
  assert.deepEqual(prepareRiskStatistics('252', '5'), { periodsPerYear: 252, annualRiskFreeRate: 0.05 });
  assert.deepEqual(prepare({ periodsPerYear: '8760', annualRiskFreeRatePercent: '-2' }).riskStatistics, { periodsPerYear: 8760, annualRiskFreeRate: -0.02 });
  for (const args of [['', '5'], ['0', '0'], ['NaN', '0'], ['1e8', '0'], ['252', '-100'], ['252', 'Infinity'], ['252', '1001']]) assert.throws(() => prepareRiskStatistics(...args));
});

test('polls only pending and running backtests', () => {
  assert.equal(isActiveBacktest('PENDING'), true);
  assert.equal(isActiveBacktest('RUNNING'), true);
  for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) assert.equal(isActiveBacktest(status), false);
});

test('comparison surfaces different periods, costs, position sizes and data', () => {
  const run = { market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' }, range: { start: 0, end: 1000 }, settings: { initialCapital: '10000', commissionPercent: '0.1', slippageTicks: 1, positionSizing: { type: 'percent_of_equity', value: '10' } }, dataset: { checksum: 'same' } };
  assert.deepEqual(comparisonNotes([run, structuredClone(run)]), []);
  const changed = { ...run, range: { start: 1, end: 2000 }, settings: { ...run.settings, commissionPercent: '0', positionSizing: { type: 'cash', value: '500' } }, dataset: { checksum: 'other' } };
  const notes = comparisonNotes([run, changed]);
  assert.equal(notes.length, 4);
  assert.ok(notes.some(note => note.includes('Different periods')));
  assert.ok(notes.some(note => note.includes('transaction costs')));
  assert.ok(notes.some(note => note.includes('position sizing')));
  assert.ok(notes.some(note => note.includes('datasets')));
});

test('equity plots use elapsed time and center flat curves', () => {
  const points = [{ time: 0, equity: '100' }, { time: 10, equity: '100' }, { time: 100, equity: '100' }];
  const segments = equitySegments(points, 200);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].width, 20);
  assert.equal(segments[1].width, 180);
  assert.equal(segments[0].top, 69);
  assert.equal(segments[0].angle, 0);
  assert.deepEqual(equitySegments([{ time: 0, equity: 'bad' }], 200), []);
});

test('large quote equity curves render a bounded number of segments and retain troughs', () => {
  const points = Array.from({ length: 20000 }, (_, time) => ({ time, equity: time === 10001 ? '1' : '100' }));
  const segments = equitySegments(points, 320);
  assert.ok(segments.length <= 239);
  assert.ok(segments.some(segment => segment.angle > 1));
  assert.ok(segments.some(segment => segment.angle < -1));
});

test('research import rejects invalid structure and oversized pasted documents', () => {
  assert.deepEqual(parseDatasetDocument('{"schemaVersion":1}'), { schemaVersion: 1 });
  for (const input of ['', '{bad', 'null', '[]', '42']) assert.throws(() => parseDatasetDocument(input));
  assert.throws(() => parseDatasetDocument(JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) })));
});

test('research candle counts reject fractions and values outside server limits', () => {
  assert.equal(researchInteger('500', 'Training candles', 100, 30000), 500);
  for (const input of ['99', '30001', '1e3', '100.1', '-1', '']) assert.throws(() => researchInteger(input, 'Training candles', 100, 30000));
});

test('research objectives display actual drawdown and ratio values instead of ranking utility', () => {
  const drawdown = { score: -12, rankingScore: -12, objectiveValue: 12, metrics: { maxDrawdownPercent: '12', totalReturnPercent: '5' } };
  assert.equal(researchObjectiveValue(drawdown, 'min_drawdown'), 12);
  assert.equal(researchObjectiveValue({ ...drawdown, objectiveValue: undefined }, 'min_drawdown'), '12');
  assert.equal(researchObjectiveInfo('min_drawdown').suffix, '%');
  assert.match(researchObjectiveInfo('min_drawdown').selection, /Lowest/);
  const ratio = { score: 1.25, objectiveValue: 1.25, metrics: { riskStatistics: { sharpe: '1.25', sortino: '2.4' } } };
  assert.equal(researchObjectiveValue(ratio, 'sharpe'), 1.25);
  assert.equal(researchObjectiveValue({ ...ratio, objectiveValue: undefined }, 'sortino'), '2.4');
  assert.equal(researchObjectiveInfo('sharpe').suffix, '');
  assert.equal(researchObjectiveInfo('sortino').suffix, '');
});

test('legacy research defaults to return and never interprets unknown ratio utilities as real metrics', () => {
  assert.equal(researchObjectiveValue({ score: 8, metrics: { totalReturnPercent: '8.1' } }), '8.1');
  assert.equal(researchObjectiveValue({ score: 8 }), 8);
  assert.equal(researchObjectiveInfo().suffix, '%');
  assert.equal(researchObjectiveValue({ score: -12 }, 'min_drawdown'), null);
  assert.equal(researchObjectiveValue({ score: 2, metrics: { riskStatistics: { sharpe: null } } }, 'sharpe'), null);
});
