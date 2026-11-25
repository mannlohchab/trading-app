import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRunId, liveTerminationDescription, mergeResearchRunRefs, parseResearchRun, researchMetricPreview, researchRunLink, shouldPollResearchRun } from '../src/lib/aiResearchRun.ts';

const id = 'e3a5024b-d853-49eb-aec8-5203848cfd67';
const base = { kind: 'backtest', id, status: 'PENDING', title: 'Historical EMA study' };

test('accepts persisted research references and drops unbounded nested summaries', () => {
  const card = parseResearchRun({ ...base, market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' }, range: { start: 0, end: 1000 }, summary: { totalTrades: 5, netProfit: '22.10', payload: { huge: true }, tooLong: 'x'.repeat(161) } });
  assert.equal(card.id, id);
  assert.deepEqual(card.summary, { totalTrades: 5, netProfit: '22.10' });
  assert.deepEqual(card.range, { start: 0, end: 1000 });
});

test('rejects unknown kinds, status mismatches and path injection', () => {
  for (const bad of [null, [], { ...base, id: '../../users' }, { ...base, kind: 'order' }, { ...base, status: 'STOPPED' }, { ...base, kind: 'paper', status: 'PENDING' }, { ...base, title: '' }]) assert.equal(parseResearchRun(bad), null);
  assert.equal(isRunId(id), true);
  assert.equal(isRunId([id]), false);
  assert.equal(parseResearchRun({ ...base, range: { start: 5, end: 1 } }).range, undefined);
  assert.equal(parseResearchRun({ ...base, range: { start: 5, end: 9_000_000_000_000_000 } }).range, undefined);
});

test('polls active research and resumable paper tests, stops terminal statuses', () => {
  for (const kind of ['backtest', 'experiment']) {
    for (const status of ['PENDING', 'RUNNING']) assert.equal(shouldPollResearchRun(kind, status), true);
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) assert.equal(shouldPollResearchRun(kind, status), false);
  }
  for (const status of ['CREATED', 'RUNNING', 'PAUSED']) assert.equal(shouldPollResearchRun('paper', status), true);
  for (const status of ['STOPPED', 'FAILED']) assert.equal(shouldPollResearchRun('paper', status), false);
});

test('routes each persisted kind to its own detail and selects experiments by id', () => {
  assert.deepEqual(researchRunLink(base), { pathname: '/backtests/[id]', params: { id } });
  assert.deepEqual(researchRunLink({ ...base, kind: 'experiment' }), { pathname: '/backtests/research', params: { experimentId: id } });
  assert.deepEqual(researchRunLink({ ...base, kind: 'paper' }), { pathname: '/backtests/live/[id]', params: { id } });
});

test('stopped timed tests continue polling only while requested closure is pending', () => {
  assert.equal(shouldPollResearchRun('paper', 'STOPPED', 'PENDING'), true);
  for (const outcome of ['CLOSED', 'NO_POSITION', 'FAILED', 'NOT_REQUESTED', undefined]) assert.equal(shouldPollResearchRun('paper', 'STOPPED', outcome), false);
  assert.equal(shouldPollResearchRun('backtest', 'COMPLETED', 'PENDING'), false);
  assert.equal(shouldPollResearchRun('paper', 'FAILED', 'PENDING'), false);
});

test('deadline messages distinguish closure failure, pending and retained positions', () => {
  const termination = { reason: 'DEADLINE', at: 1000, closeStatus: 'PENDING' };
  assert.match(liveTerminationDescription(termination), /closure is pending/);
  assert.match(liveTerminationDescription({ ...termination, closeStatus: 'FAILED', message: 'Quote is stale.' }), /closure failed.*Quote is stale/);
  assert.match(liveTerminationDescription({ ...termination, closeStatus: 'NOT_REQUESTED' }), /not requested/);
  assert.match(liveTerminationDescription({ ...termination, closeStatus: 'CLOSED' }), /position was closed/);
  assert.match(liveTerminationDescription({ ...termination, closeStatus: 'NO_POSITION' }), /no position to close/);
  assert.equal(liveTerminationDescription(null), undefined);
});

test('subsequent tool updates replace the same run without duplicating chat cards', () => {
  const next = { ...base, status: 'COMPLETED' };
  assert.deepEqual(mergeResearchRunRefs([base], [next]), [next]);
  assert.equal(mergeResearchRunRefs([base], [{ ...next, kind: 'experiment' }]).length, 2);
});

test('metric previews retain zero and negative values without inventing absent results', () => {
  assert.deepEqual(researchMetricPreview(undefined), []);
  const values = researchMetricPreview({ totalReturnPercent: '-2.5', netProfit: '0', maxDrawdownPercent: null, totalTrades: 0, finalEquity: 'NaN' });
  assert.deepEqual(values.map(metric => metric.value), ['-2.5', '0', 0]);
  assert.deepEqual(researchMetricPreview({ testWindows: 3 }).map(metric => metric.label), ['Unseen test windows']);
});
