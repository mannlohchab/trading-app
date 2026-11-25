import { expect, test } from 'bun:test';
import { MimoChatProvider, MimoResearchModel, MimoScriptLlm, MIMO_MODELS, type ChatStreamEvent } from '../../src/modules/ai';

const sse = (...chunks: unknown[]) =>
  new Response(chunks.map(c => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
// The shape MiMo streams: every delta carries content, reasoning_content and tool_calls, often null.
const delta = (d: Record<string, unknown>, finish: string | null = null) =>
  ({ model: 'mimo-v2.6-pro-ultraspeed', choices: [{ index: 0, delta: { role: 'assistant', content: null, reasoning_content: null, tool_calls: null, ...d }, finish_reason: finish }] });

async function collect(provider: MimoChatProvider, tools = false) {
  const events: ChatStreamEvent[] = [];
  for await (const e of provider.stream({
    model: 'mimo-v2.6-pro-ultraspeed',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'BTC?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_tickers', arguments: '{"symbols":["BTCUSDT"]}' }], reasoning: 'think' },
      { role: 'tool', toolCallId: 'c1', content: '{"price":1}' },
    ],
    ...(tools && { tools: [{ name: 'show_chart', description: 'chart', parameters: { type: 'object' } }] }),
    maxOutputTokens: 100,
    temperature: 0.3,
  })) events.push(e);
  return events;
}

test('streams text as it arrives, assembles tool calls and reports usage', async () => {
  let request: any, url = '', auth = '';
  const provider = new MimoChatProvider({
    apiKey: 'tp-test',
    fetch: async (u, init) => {
      url = u; auth = new Headers(init?.headers).get('authorization') ?? '';
      request = JSON.parse(String(init?.body));
      return sse(
        delta({ reasoning_content: 'Look ' }),
        delta({ content: 'BTC ' }),
        delta({ content: 'is up.' }),
        delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'show_chart', arguments: '{"symbol": ' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"BTCUSDT"}' } }] }, 'tool_calls'),
        { choices: [], usage: { prompt_tokens: 20, completion_tokens: 7 } },
        '[DONE]',
      );
    },
  });
  const events = await collect(provider, true);
  expect(url).toBe('https://token-plan-sgp.xiaomimimo.com/v1/chat/completions');
  expect(auth).toBe('Bearer tp-test');
  expect(request).toMatchObject({ model: 'mimo-v2.6-pro-ultraspeed', stream: true, max_tokens: 100, tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'show_chart' } }] });
  // Reasoning is not sent back; tool calls and results are.
  expect(request.messages[2]).toEqual({ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_tickers', arguments: '{"symbols":["BTCUSDT"]}' } }] });
  expect(request.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"price":1}' });
  expect(events).toEqual([
    { type: 'text', delta: 'BTC ' },
    { type: 'text', delta: 'is up.' },
    { type: 'tool_call', call: { id: 'call_a', name: 'show_chart', arguments: '{"symbol": "BTCUSDT"}' } },
    { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 20, outputTokens: 7 }, reasoning: 'Look ' },
  ]);
});

test('maps key, rate-limit and quota failures without leaking the key', async () => {
  const failing = (status: number) => new MimoChatProvider({ apiKey: 'tp-secret', fetch: async () => Response.json({ error: { message: 'nope', code: String(status) } }, { status }) });
  const codes = await Promise.all([401, 429, 402, 500].map(async s => collect(failing(s)).catch(e => e)));
  expect(codes.map(e => [e.code, e.retryable])).toEqual([['AI_AUTH_ERROR', false], ['AI_RATE_LIMITED', true], ['AI_PROVIDER_QUOTA', false], ['AI_PROVIDER_ERROR', true]]);
  for (const e of codes) expect(e.message).not.toContain('tp-secret');
});

test('research and Morning Decode use the same endpoint without streaming', async () => {
  const bodies: any[] = [];
  const fetch = async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: ' Answer ', reasoning_content: 'r', tool_calls: bodies.length === 1 ? [{ id: 'x', function: { name: 'search_web', arguments: '{"query":"btc etf"}' } }] : null } }] });
  };
  const research = new MimoResearchModel({ apiKey: 'k', model: 'mimo-v2.6-pro-ultraspeed', fetch });
  expect(await research.complete({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'search_web', description: 'd', parameters: { type: 'object' } }], maxOutputTokens: 500 }))
    .toEqual({ content: 'Answer', toolCalls: [{ id: 'x', name: 'search_web', arguments: '{"query":"btc etf"}' }], reasoning: 'r', model: 'mimo-v2.6-pro-ultraspeed' });
  const script = new MimoScriptLlm({ apiKey: 'k', model: 'mimo-v2.6-pro-ultraspeed', fetch });
  expect(await script.complete({ system: 's', user: 'u' })).toEqual({ text: 'Answer', model: 'mimo-v2.6-pro-ultraspeed' });
  expect(bodies[0]).not.toHaveProperty('stream');
  expect(bodies[1]).toMatchObject({ max_tokens: 6000, messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] });
});

test('every MiMo profile supports tools and is served by the mimo provider', () => {
  expect(MIMO_MODELS.map(m => [m.id, m.provider, m.supportsTools])).toEqual([
    ['mimo-ultraspeed', 'mimo', true], ['mimo-pro', 'mimo', true], ['mimo-flash', 'mimo', true],
  ]);
});

test('reasoning effort is sent; a no-thinking retry switches thinking off instead', async () => {
  const bodies: any[] = [];
  const provider = new MimoChatProvider({ apiKey: 'k', fetch: async (_u, init) => { bodies.push(JSON.parse(String(init?.body))); return sse(delta({ content: 'ok' }, 'stop'), '[DONE]'); } });
  for (const disableThinking of [false, true]) {
    for await (const _ of provider.stream({ model: 'mimo-v2.6-pro', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10, reasoningEffort: 'low', disableThinking })) { /* drain */ }
  }
  expect(bodies[0]).toMatchObject({ reasoning_effort: 'low' });
  expect(bodies[0]).not.toHaveProperty('thinking');
  expect(bodies[1]).toMatchObject({ thinking: { type: 'disabled' } });
  expect(bodies[1]).not.toHaveProperty('reasoning_effort');
});
