import { expect, test } from 'bun:test';
import { AiProviderError, OpenRouterChatProvider, type ChatStreamEvent } from '../../src/modules/ai';
import { FREE_NEMOTRON_MODEL } from '../../src/modules/ai/domain/free-nemotron';

const sse = (...chunks: unknown[]) =>
  new Response(chunks.map(chunk => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

const usage = { prompt_tokens: 20, completion_tokens: 4, cost: 0, cost_details: { upstream_inference_cost: 0 } };

async function collect(provider: OpenRouterChatProvider) {
  const events: ChatStreamEvent[] = [];
  for await (const event of provider.stream({
    model: FREE_NEMOTRON_MODEL,
    messages: [{ role: 'user', content: 'hi' }],
    maxOutputTokens: 100,
  })) events.push(event);
  return events;
}

test('streams free Nemotron with a zero price ceiling and returns reasoning for the next tool round', async () => {
  let request: any;
  const provider = new OpenRouterChatProvider({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return sse(
        { model: FREE_NEMOTRON_MODEL, choices: [{ delta: { reasoning: 'Look ', reasoning_details: [{ type: 'reasoning.text', text: 'Look ', format: 'unknown', index: 0 }] } }] },
        { model: FREE_NEMOTRON_MODEL, choices: [{ delta: { reasoning: 'up.', reasoning_details: [{ type: 'reasoning.text', text: 'up.', format: 'unknown', index: 0 }] } }] },
        { model: FREE_NEMOTRON_MODEL, choices: [{ delta: { content: 'BTC ' } }] },
        { model: FREE_NEMOTRON_MODEL, choices: [{ delta: { content: 'is up.' }, finish_reason: 'stop' }] },
        { model: FREE_NEMOTRON_MODEL, choices: [], usage },
        '[DONE]',
      );
    },
  });
  const events = await provider.stream({
    model: FREE_NEMOTRON_MODEL,
    messages: [
      { role: 'user', content: 'price?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'get_quote', arguments: '{}' }], reasoning: 'earlier', reasoningDetails: [{ index: 0, type: 'reasoning.text', text: 'earlier' }] },
      { role: 'tool', toolCallId: 'c0', content: '{"price":1}' },
    ],
    tools: [{ name: 'get_quote', description: 'quote', parameters: { type: 'object' } }],
    maxOutputTokens: 100,
    temperature: 0.3,
  });
  const seen: ChatStreamEvent[] = [];
  for await (const event of events) seen.push(event);
  expect(request.model).toBe(FREE_NEMOTRON_MODEL);
  expect(request.stream).toBe(true);
  expect(request.provider).toEqual({
    allow_fallbacks: false,
    sort: 'price',
    max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
  });
  expect(request).not.toHaveProperty('models');
  expect(request).not.toHaveProperty('plugins');
  expect(request.messages[1].reasoning_details).toEqual([{ index: 0, type: 'reasoning.text', text: 'earlier' }]);
  expect(seen[0]).toEqual({ type: 'text', delta: 'BTC is up.' });
  expect(seen[1]).toMatchObject({ type: 'done', reasoning: 'Look up.', usage: { costUnits: 0, costUnit: 'usd' } });
  expect((seen[1] as { reasoningDetails: { text: string }[] }).reasoningDetails[0]?.text).toBe('Look up.');
});

test('refuses a paid model before the request and discards a billed stream', async () => {
  let called = false;
  const paid = new OpenRouterChatProvider({ apiKey: 'test-key', fetch: async () => { called = true; return sse(); } });
  let refused: unknown;
  try {
    for await (const _event of paid.stream({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 20 })) { /* unused */ }
  } catch (error) {
    refused = error;
  }
  expect(refused).toBeInstanceOf(AiProviderError);
  expect(called).toBe(false);

  const billed = new OpenRouterChatProvider({
    apiKey: 'test-key',
    fetch: async () => sse(
      { model: 'openai/gpt-4o-mini', choices: [{ delta: { content: 'paid' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } },
      '[DONE]',
    ),
  });
  const error = await collect(billed).catch(caught => caught);
  expect(error).toBeInstanceOf(AiProviderError);
  expect(error.code).toBe('AI_PROVIDER_QUOTA');
});

test('rate limits are retryable and a rejected key is not', async () => {
  const limited = new OpenRouterChatProvider({
    apiKey: 'test-key',
    fetch: async () => Response.json({ error: { message: 'rate limit' } }, { status: 429 }),
  });
  const rate = await collect(limited).catch(error => error);
  expect([rate.code, rate.retryable]).toEqual(['AI_RATE_LIMITED', true]);

  const unauthorized = new OpenRouterChatProvider({
    apiKey: 'test-key',
    fetch: async () => Response.json({ error: { message: 'bad key' } }, { status: 401 }),
  });
  const auth = await collect(unauthorized).catch(error => error);
  expect([auth.code, auth.retryable]).toEqual(['AI_AUTH_ERROR', false]);
});
