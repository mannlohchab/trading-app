import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createToolMarkupFilter, parseToolMarkup } from '../../src/modules/ai/domain/tool-markup';
import { coerceToSchema } from '../../src/modules/ai/application/tool-arguments';
import { defineTool } from '../../src/modules/ai/application/tool-definition';
import { createTools } from '../../src/modules/ai/application/tools';
import { CONVERSATION_LIMITS } from '../../src/modules/ai/domain/conversation';
import { call, done, text } from '../helpers/fake-ai';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';

// What Nemotron printed in the reported chat (trimmed).
const LEAKED = `Here is a plan.
<tool_call>
<function=draft_strategy>
<parameter=symbol>
BTCUSDT
</parameter>
<parameter=timeframe>
15m
</parameter>
<parameter=entry>
{"type": "indicator", "indicator": "RSI", "period": 14, "condition": "crosses_above", "level": 30}
</parameter>
</function>
</tool_call>
Done.`;

const run = (chunks: string[]) => {
  const f = createToolMarkupFilter();
  const shown = chunks.map(c => f.push(c)).join('') + f.flush();
  return { shown, calls: f.calls, removed: f.removed };
};

describe('tool-call markup in text', () => {
  test('removed from what the user sees, however the stream is split, and read back as a call', () => {
    const splits = [[LEAKED], [...LEAKED], LEAKED.match(/[\s\S]{1,7}/g)!];
    for (const chunks of splits) {
      const { shown, calls } = run(chunks);
      expect(shown).toBe('Here is a plan.\n\nDone.');
      expect(calls).toEqual([{ name: 'draft_strategy', arguments: JSON.stringify({
        symbol: 'BTCUSDT', timeframe: '15m',
        entry: '{"type": "indicator", "indicator": "RSI", "period": 14, "condition": "crosses_above", "level": 30}',
      }) }]);
    }
  });

  test('Hermes JSON calls, bare <function=…> blocks and unterminated blocks', () => {
    expect(parseToolMarkup('<tool_call>{"name": "get_tickers", "arguments": {"symbols": ["BTCUSDT"]}}</tool_call>'))
      .toEqual({ name: 'get_tickers', arguments: '{"symbols":["BTCUSDT"]}' });
    expect(run(['Ok <function=show_chart><parameter=symbol>ETHUSDT</parameter></function> bye']))
      .toMatchObject({ shown: 'Ok  bye', calls: [{ name: 'show_chart', arguments: '{"symbol":"ETHUSDT"}' }] });
    // Cut off mid-call (output limit): nothing of it is shown.
    expect(run(['Sure.\n<tool_call>\n<function=draft_strategy>\n<parameter=symbol>BTC'])).toMatchObject({ shown: 'Sure.\n', removed: true });
  });

  test('ordinary text with angle brackets is untouched', () => {
    for (const plain of ['Buy when RSI < 30 and price <= support.', 'Use <b>bold</b>? No: a < b', 'ends with <', 'ends with <func']) {
      expect(run([...plain])).toEqual({ shown: plain, calls: [], removed: false });
    }
  });
});

describe('tool arguments', () => {
  test('every tool schema states parameter types directly (no $ref)', () => {
    const tools = createTools({ exchange: 'BINANCE' } as any, {} as any, { gateway: {} as any, userId: 'u' }, undefined,
      { gateway: {} as any, userId: 'u' }, { gateway: {} as any, userId: 'u' }, { research: async () => ({}) as any });
    for (const tool of tools) expect(JSON.stringify(tool.spec.parameters)).not.toContain('$ref');
  });

  test('text-written values are converted to the declared types; unknown keys are still refused', async () => {
    const tool = defineTool('t', 't', z.strictObject({
      candles: z.number().int().min(20).max(150).default(60),
      overlays: z.array(z.enum(['SMA20', 'SMA50'])).max(4).default([]),
      symbols: z.array(z.string()).optional(),
      stopLoss: z.number().nullish(),
      flag: z.boolean().optional(),
      market: z.strictObject({ symbol: z.string(), size: z.number() }).optional(),
    }), async args => ({ result: args }));
    const { result } = await tool.run({ candles: '120', overlays: '["SMA20", "SMA50"]', symbols: 'BTCUSDT', stopLoss: '1.5', flag: 'true', market: '{"symbol": "BTCUSDT", "size": "5"}' });
    expect(result).toEqual({ candles: 120, overlays: ['SMA20', 'SMA50'], symbols: ['BTCUSDT'], stopLoss: 1.5, flag: true, market: { symbol: 'BTCUSDT', size: 5 } });
    await expect(tool.run({ candles: '120', exchange: 'BINANCE' })).rejects.toThrow('Unrecognized key');
    await expect(tool.run({ candles: 'lots' })).rejects.toThrow('candles');
    expect(coerceToSchema('42', { type: 'string' })).toBe('42');
  });
});

describe('assistant turns', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let u: Awaited<ReturnType<typeof activeUser>>;
  beforeAll(async () => {
    t = await createTestApp();
    await t.market.catalog.sync('BINANCE');
    u = await activeUser(t);
  });
  afterAll(() => t.close());
  const ask = async (content: string) => {
    const id = (await u.c.post('/api/v1/ai/conversations', {})).body.id as string;
    return u.c.post(`/api/v1/ai/conversations/${id}/messages`, { content, stream: false });
  };

  test('a call written as text is run like a real one, and never shown', async () => {
    t.model.script(
      [text('Let me check.\n<tool_call>\n<function=get_tickers>\n<parameter=symbols>\n["BTCUSDT"]\n</parameter>\n</function>\n</tool_call>'), done()],
      [text('BTC is at 73,886 USDT.'), done()],
    );
    const res = await ask('BTC price?');
    expect(res.status).toBe(201);
    const reply = res.body.assistantMessage;
    expect(reply.content).toBe('Let me check.\nBTC is at 73,886 USDT.');
    expect(reply.content).not.toContain('<');
    expect(reply.metadata.toolCalls).toMatchObject([{ name: 'get_tickers', ok: true, arguments: { symbols: ['BTCUSDT'] } }]);
    expect(reply.metadata.blocks.map((b: any) => b.type)).toContain('ticker');
    const second = t.model.requests[1]!.messages;
    expect(second.find(m => m.role === 'assistant')).toMatchObject({ content: 'Let me check.\n', toolCalls: [{ id: 'text_call_0_0', name: 'get_tickers' }] });
  });

  test('out of tool steps: the model is told to answer, and leaked markup becomes a short note', async () => {
    const loop = () => [call('get_tickers', { symbols: ['BTCUSDT'] }), done(100, 10, 'tool_calls')];
    t.model.script(
      ...Array.from({ length: CONVERSATION_LIMITS.maxToolRounds }, loop),
      [text(LEAKED.replace('Here is a plan.\n', '').replace('\nDone.', '')), done()],
    );
    const reply = (await ask('Make me an intraday BTC strategy')).body.assistantMessage;
    const last = t.model.requests.at(-1)!;
    expect(last.tools).toBeUndefined();
    expect(last.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('All tool steps for this reply are used up') });
    expect(t.model.requests[0]!.messages.some(m => m.role === 'user' && String(m.content).includes('Note from the app'))).toBe(false);
    expect(reply.content).toBe('I ran out of steps before I could finish this. Ask me to continue and I will pick up from the results above.');
    expect(reply.metadata.toolCalls).toHaveLength(CONVERSATION_LIMITS.maxToolRounds);
  });
});

test('stripToolMarkup cleans stored replies', async () => {
  const { stripToolMarkup } = await import('../../src/modules/ai/domain/tool-markup');
  expect(stripToolMarkup(LEAKED)).toBe('Here is a plan.\n\nDone.');
  expect(stripToolMarkup('<tool_call>\n<function=draft_strategy>\n<parameter=symbol>\nBTCUSDT')).toBe('');
});
