import { expect, test } from 'bun:test';
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
