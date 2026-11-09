import { expect, test } from 'bun:test';
import { AiProviderError, WorkersAiProvider, type ChatStreamEvent } from '../../src/modules/ai';

const sse = (...chunks: unknown[]) =>
  new Response(chunks.map(c => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

async function collect(provider: WorkersAiProvider, extra: object = {}) {
  const events: ChatStreamEvent[] = [];
  for await (const e of provider.stream({ model: '@cf/x', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 100, ...extra })) events.push(e);
  return events;
}

test('streams text, assembles split tool calls and reports usage in neurons', async () => {
  let request: any;
  const provider = new WorkersAiProvider({
    accountId: 'acc', apiToken: 'tok',
    fetch: async (url, init) => {
      request = { url, headers: init!.headers, body: JSON.parse(String(init!.body)) };
      return sse(
        { choices: [{ delta: { content: 'Let me ' } }] },
        { choices: [{ delta: { content: 'check.' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_tickers', arguments: '{"symbols":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '["BTCUSDT"]}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 170, completion_tokens: 9, neurons: 4.87 } },
        '[DONE]',
      );
    },
  });
  const events = await collect(provider, {
    tools: [{ name: 'get_tickers', description: 'd', parameters: { type: 'object' } }],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, toolCalls: [{ id: 'c0', name: 'x', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c0', content: '{"ok":true}' },
    ],
  });
  expect(request.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions');
  expect(request.headers.Authorization).toBe('Bearer tok');
  expect(request.body).toMatchObject({ model: '@cf/x', stream: true, max_tokens: 100, tools: [{ type: 'function', function: { name: 'get_tickers' } }] });
  expect(request.body.messages[1]).toEqual({ role: 'assistant', content: '', tool_calls: [{ id: 'c0', type: 'function', function: { name: 'x', arguments: '{}' } }] });
  expect(request.body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c0', content: '{"ok":true}' });
  expect(events).toEqual([
    { type: 'text', delta: 'Let me ' },
    { type: 'text', delta: 'check.' },
    { type: 'tool_call', call: { id: 'c1', name: 'get_tickers', arguments: '{"symbols":["BTCUSDT"]}' } },
    { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 170, outputTokens: 9, costUnits: 4.87, costUnit: 'neurons' } },
  ]);
});

test('Cloudflare errors map to provider-neutral codes', async () => {
  const cases: [number, object, string, boolean][] = [
    [429, { errors: [{ code: 3036, message: 'You have used up your daily free allocation of 10,000 neurons' }] }, 'AI_PROVIDER_QUOTA', false],
    [403, { errors: [{ message: 'AiError: Model @cf/x is not available on the Workers Free plan' }] }, 'AI_MODEL_UNAVAILABLE', true],
    [401, { errors: [{ code: 10000, message: 'Authentication error' }] }, 'AI_AUTH_ERROR', false],
    [429, { errors: [{ message: 'Too many requests' }] }, 'AI_RATE_LIMITED', true],
    [500, {}, 'AI_PROVIDER_ERROR', true],
  ];
  for (const [status, body, code, retryable] of cases) {
    const provider = new WorkersAiProvider({ accountId: 'a', apiToken: 't', fetch: async () => Response.json(body, { status }) });
    const error = await collect(provider).catch(e => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect([error.code, error.retryable]).toEqual([code, retryable]);
  }
});

test('network failures and timeouts are retryable provider errors', async () => {
  const down = new WorkersAiProvider({ accountId: 'a', apiToken: 't', fetch: async () => { throw new TypeError('ECONNREFUSED'); } });
  expect(await collect(down).catch(e => e.code)).toBe('AI_PROVIDER_ERROR');
  const slow = new WorkersAiProvider({ accountId: 'a', apiToken: 't', timeoutMs: 20, fetch: (_u, init) => new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))) });
  expect(await collect(slow).catch(e => e.code)).toBe('AI_TIMEOUT');
});

test('number-only tokens sent as JSON numbers keep every digit', async () => {
  const provider = new WorkersAiProvider({
    accountId: 'a', apiToken: 't',
    fetch: async () => new Response([
      '{"choices":[{"delta":{"content":"BTC is $"}}]}',
      '{"choices":[{"delta":{"content":74291}}]}',
      '{"choices":[{"delta":{"content":"."}}]}',
      '{"choices":[{"delta":{"content":2113.90}}]}',
      '{"choices":[{"delta":{"content":" and 0"}}]}',
      '[DONE]',
    ].map(d => `data: ${d}\n\n`).join('')),
  });
  const events = await collect(provider);
  expect(events.filter(e => e.type === 'text').map(e => (e as any).delta).join('')).toBe('BTC is $74291.2113.90 and 0');
});
