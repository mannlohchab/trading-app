import { buildChart } from '../../src/modules/ai/domain/chart';
import { createCodeFilter } from '../../src/modules/ai/domain/code-filter';
import { describe, expect, test } from 'bun:test';
import { assembleBlocks } from '../../src/modules/ai/domain/blocks';
import { CONVERSATION_LIMITS, selectHistory, titleFromMessage } from '../../src/modules/ai/domain/conversation';
import { buildSystemPrompt } from '../../src/modules/ai/domain/prompt';
import { decideQuota } from '../../src/modules/ai/domain/usage-policy';

test('titles come from the first message, cut at a word', () => {
  expect(titleFromMessage('  Is   BTC trending up? ')).toBe('Is BTC trending up?');
  const long = titleFromMessage('Please build me a swing trading strategy for ETHUSDT on the four hour chart using RSI and moving averages');
  expect(long.length).toBeLessThanOrEqual(CONVERSATION_LIMITS.titleMaxChars);
  expect(long.endsWith('…')).toBe(true);
});

test('history keeps the newest messages within budget and never starts with an assistant reply', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'ASSISTANT' as const : 'USER' as const, content: `m${i}` }));
  const picked = selectHistory(msgs);
  expect(picked.length).toBeLessThanOrEqual(CONVERSATION_LIMITS.historyMaxMessages);
  expect(picked.at(-1)!.content).toBe('m29');
  expect(picked[0]!.role).toBe('USER');
  expect(selectHistory([{ role: 'USER', content: 'x'.repeat(30_000) }])).toEqual([]);
});

test('daily quota resets at 00:00 UTC', () => {
  const now = new Date('2026-11-09T22:30:00Z');
  expect(decideQuota({ turns: 1, inputTokens: 10, outputTokens: 10 }, { turnsPerDay: 2, tokensPerDay: 100 }, now)).toEqual({ allowed: true });
  expect(decideQuota({ turns: 2, inputTokens: 0, outputTokens: 0 }, { turnsPerDay: 2, tokensPerDay: 100 }, now))
    .toEqual({ allowed: false, reason: 'DAILY_TURN_LIMIT', resetAt: new Date('2026-11-10T00:00:00Z') });
  expect(decideQuota({ turns: 0, inputTokens: 60, outputTokens: 40 }, { turnsPerDay: 2, tokensPerDay: 100 }, now)).toMatchObject({ reason: 'DAILY_TOKEN_LIMIT' });
});

test('the system prompt reflects the user\'s AI preferences', () => {
  const p = buildSystemPrompt({ responseStyle: 'CONCISE', explanationLevel: 'ADVANCED', language: 'hi-IN', timezone: 'Asia/Kolkata' }, new Date('2026-11-09T08:00:00Z'));
  expect(p).toContain('under 120 words');
  expect(p).toContain('experienced');
  expect(p).toContain('"hi-IN"');
  expect(p).toContain('Asia/Kolkata');
  expect(p).toContain('Never invent');
});

test('blocks: text first, data cards, drafts, disclaimer last', () => {
  const blocks = assembleBlocks(' Hello ', [
    { type: 'strategy_draft', draftId: 'd1', draft: {}, summary: [] },
    { type: 'ticker', data: {} },
  ]);
  expect(blocks.map(b => b.type)).toEqual(['markdown', 'ticker', 'strategy_draft', 'disclaimer']);
  expect(assembleBlocks('', []).map(b => b.type)).toEqual(['disclaimer']);
});

describe('chart cards', () => {
  const bar = (i: number, close: string, isClosed = true) => ({ openTime: i * 60_000, open: close, high: close, low: close, close, isClosed });
  const base = { exchange: 'BINANCE', symbol: 'XRPUSDT', timeframe: '1m', chartType: 'line' as const, source: 'exchange' };

  test('shows the newest candles and skips the unfinished one', () => {
    const candles = [...Array.from({ length: 10 }, (_, i) => bar(i, String(1 + i / 100))), bar(10, '9', false)];
    const chart = buildChart({ ...base, candles, visible: 5, overlays: [] })!;
    expect(chart.candles.map(c => c[0])).toEqual([5, 6, 7, 8, 9].map(i => i * 60_000));
    expect(chart).toMatchObject({ lastClose: 1.09, lines: [], levels: [], pricePrecision: 2 });
  });

  test('moving averages without enough history are left out; levels come from the visible candles', () => {
    const candles = Array.from({ length: 12 }, (_, i) => bar(i, (0.5 + i * 0.0001).toFixed(4)));
    const chart = buildChart({ ...base, candles, visible: 12, overlays: ['SMA50', 'SMA20', 'SUPPORT_RESISTANCE'] })!;
    expect(chart.lines).toEqual([]);
    expect(chart.pricePrecision).toBe(4);
    expect(chart.levels).toEqual([
      { kind: 'resistance', label: 'Resistance (12-candle high)', price: 0.5011 },
      { kind: 'support', label: 'Support (12-candle low)', price: 0.5 },
    ]);
  });

  test('needs at least two candles', () => {
    expect(buildChart({ ...base, candles: [bar(0, '1')], visible: 60, overlays: [] })).toBeNull();
  });
});

describe('code filter', () => {
  const run = (chunks: string[]) => {
    const f = createCodeFilter();
    const out = chunks.map(c => f.push(c)).join('') + f.flush();
    return { out, removed: f.removed };
  };

  test('removes fenced blocks, keeping the prose around them', () => {
    expect(run(['Idea first.\n\n```json\n{"name":"BTC"}\n```\n\nRisks next.'])).toEqual({ out: 'Idea first.\n\n\n\nRisks next.', removed: true });
  });

  test('fences split across chunks are still caught', () => {
    expect(run(['Rules:\n`', '``pine\n//@version=5\nstrategy("x")\n`', '`', '`\nDone.']).out).toBe('Rules:\n\nDone.');
  });

  test('an unclosed block is dropped; inline code and plain text pass through', () => {
    expect(run(['Before ```json\n{"a":', '1']).out).toBe('Before ');
    expect(run(['Use the `RSI` line', ' here.'])).toEqual({ out: 'Use the `RSI` line here.', removed: false });
  });
});
