import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStepEvent, formatDuration, settleSteps, stepDetails, stepsFromToolCalls, stepTitle } from '../src/lib/aiTrace.ts';

test('titles read as what the assistant is doing, then what it did', () => {
  assert.equal(stepTitle({ tool: 'get_my_holdings', status: 'running' }), 'Reading your holdings');
  assert.equal(stepTitle({ tool: 'get_my_holdings', status: 'done' }), 'Read your holdings');
  assert.equal(stepTitle({ tool: 'get_tickers', args: { symbols: ['btcusdt'] }, status: 'running' }), 'Checking BTCUSDT price');
  assert.equal(stepTitle({ tool: 'get_tickers', args: { symbols: ['A', 'B', 'C', 'D'] }, status: 'done' }), 'Checked A, B, C +1 prices');
  assert.equal(stepTitle({ tool: 'analyze_market', args: { symbol: 'ethusdt', timeframe: '1h' }, status: 'done' }), 'Analysed ETHUSDT (1h)');
  assert.equal(stepTitle({ tool: 'get_top_movers', args: { sort: 'losers' }, status: 'running' }), 'Finding top losers');
  assert.equal(stepTitle({ tool: 'show_chart', args: {}, status: 'done' }), 'Drew chart');
  assert.equal(stepTitle({ tool: 'search_symbols', args: { query: ' sol ' }, status: 'done' }), 'Searched for “sol”');
  assert.equal(stepTitle({ tool: 'new_tool', args: null, status: 'running' }), 'Using new tool');
});

test('details are readable rows, never nested JSON', () => {
  assert.deepEqual(stepDetails({ tool: 'show_chart', args: { symbol: 'BTCUSDT', timeframe: '4h', overlays: ['SMA20', 'SUPPORT_RESISTANCE'], chartType: 'candle' } }), [
    { label: 'Pair', value: 'BTCUSDT' }, { label: 'Timeframe', value: '4h' },
    { label: 'Lines', value: 'SMA20, SUPPORT_RESISTANCE' }, { label: 'Chart', value: 'candle' },
  ]);
  assert.deepEqual(stepDetails({ tool: 'draft_strategy', args: { name: 'Dip buyer', definition: { market: {} } } }), [{ label: 'Name', value: 'Dip buyer' }]);
  assert.deepEqual(stepDetails({ tool: 'get_my_holdings', args: {} }), []);
  assert.deepEqual(stepDetails({ tool: 'x', args: 'not json' }), []);
});

test('durations', () => {
  assert.equal(formatDuration(420), '0.4s');
  assert.equal(formatDuration(12), '0.1s');
  assert.equal(formatDuration(2300), '2.3s');
  assert.equal(formatDuration(65_000), '1m 5s');
  assert.equal(formatDuration(undefined), '');
});

test('streamed events start and finish steps; unfinished ones settle when the reply ends', () => {
  let steps = applyStepEvent([], { type: 'status', stage: 'thinking' });
  assert.deepEqual(steps, []);
  steps = applyStepEvent(steps, { type: 'status', stage: 'tool', tool: 'get_tickers', callId: 'c1', arguments: { symbols: ['BTCUSDT'] } });
  steps = applyStepEvent(steps, { type: 'status', stage: 'tool', tool: 'get_tickers', callId: 'c1' });
  steps = applyStepEvent(steps, { type: 'status', stage: 'tool', tool: 'analyze_market', callId: 'c2' });
  assert.deepEqual(steps.map(s => [s.id, s.status]), [['c1', 'running'], ['c2', 'running']]);
  steps = applyStepEvent(steps, { type: 'tool_result', callId: 'c1', ok: true, durationMs: 300 });
  steps = applyStepEvent(steps, { type: 'tool_result', callId: 'c2', ok: false, durationMs: 50, error: 'No data' });
  assert.deepEqual(steps.map(s => [s.status, s.durationMs, s.error]), [['done', 300, undefined], ['error', 50, 'No data']]);

  // An older server sends no callId or tool_result: the step still shows, and settles as done.
  const legacy = applyStepEvent([], { type: 'status', stage: 'tool', tool: 'get_my_holdings' });
  assert.deepEqual(settleSteps(legacy).map(s => s.status), ['done']);
  assert.deepEqual(settleSteps(legacy, 'error').map(s => s.status), ['error']);
  assert.equal(settleSteps(undefined), undefined);
});

test('saved replies rebuild their steps from metadata.toolCalls', () => {
  assert.deepEqual(stepsFromToolCalls([
    { name: 'get_my_holdings', arguments: {}, ok: true, durationMs: 412 },
    { name: 'get_tickers', arguments: { symbols: ['X'] }, ok: false, durationMs: 9, error: 'Unknown symbol' },
    { nope: true },
  ], 'm1'), [
    { id: 'm1-tool-0', tool: 'get_my_holdings', args: {}, status: 'done', durationMs: 412 },
    { id: 'm1-tool-1', tool: 'get_tickers', args: { symbols: ['X'] }, status: 'error', durationMs: 9, error: 'Unknown symbol' },
  ]);
  assert.deepEqual(stepsFromToolCalls(undefined, 'm'), []);
});
