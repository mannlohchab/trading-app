import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { config } from '../src/lib/config';
import { streamWorkersAi } from '../src/providers/workersAi';

const original = { ...config.cloudflare };
let fetchSpy: ReturnType<typeof spyOn>;
const messages = [{ role: 'user' as const, content: 'Explain diversification.' }];

beforeEach(() => {
  config.cloudflare.accountId = 'test-account';
  config.cloudflare.apiToken = 'test-token';
  fetchSpy = spyOn(globalThis, 'fetch');
});
afterEach(() => { fetchSpy.mockRestore(); Object.assign(config.cloudflare, original); });

function stream(...parts: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('missing credentials fail visibly without saving a canned AI answer', async () => {
  config.cloudflare.apiToken = '';
  const chunks: string[] = [];
  await expect(streamWorkersAi(messages, c => chunks.push(c))).rejects.toMatchObject({ statusCode: 503 });
  expect(chunks).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('sends authenticated streaming requests with an output budget and decodes split events', async () => {
  fetchSpy.mockResolvedValue(stream('data: {"res', 'ponse":"Diversify $"}\r\n\r\n', 'data: {"response":"100."}\n\ndata: [DONE]'));
  const chunks: string[] = [];
  const answer = await streamWorkersAi(messages, c => chunks.push(c));
  expect(answer).toStartWith('Diversify $100.');
  expect(answer).toContain('Educational only');
  expect(chunks.join('')).toBe(answer);
  const [url, options] = fetchSpy.mock.calls[0];
  expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/${config.cloudflare.model}`);
  expect(options.headers.Authorization).toBe('Bearer test-token');
  const body = JSON.parse(options.body);
  expect(body.messages).toEqual(messages);
  expect(body.stream).toBe(true);
  expect(body.max_tokens).toBeGreaterThan(0);
  expect(body.max_tokens).toBeLessThanOrEqual(512);
});

test('daily quota errors explain the reset time', async () => {
  fetchSpy.mockImplementation(async () => Response.json({ success: false, errors: [{ code: 3036, message: 'Account limited' }] }, { status: 429 }));
  await expect(streamWorkersAi(messages, () => {})).rejects.toMatchObject({ statusCode: 429, code: 'AI_DAILY_LIMIT' });
  await expect(streamWorkersAi(messages, () => {})).rejects.toThrow('00:00 UTC');
});

test('capacity errors are not presented as exhausted daily quota', async () => {
  fetchSpy.mockResolvedValue(Response.json({ success: false, errors: [{ code: 3040, message: 'Capacity exceeded' }] }, { status: 429 }));
  await expect(streamWorkersAi(messages, () => {})).rejects.toMatchObject({ code: 'AI_BUSY' });
});

test('provider auth failures give setup guidance without exposing the upstream body', async () => {
  fetchSpy.mockResolvedValue(new Response('private upstream detail', { status: 401 }));
  await expect(streamWorkersAi(messages, () => {})).rejects.toMatchObject({ statusCode: 503, code: 'AI_AUTH_ERROR' });
});

test('cancelled requests do not spend an inference call', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(streamWorkersAi(messages, () => {}, controller.signal)).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('paid-only models fail with free-tier model guidance', async () => {
  fetchSpy.mockResolvedValue(Response.json({ success: false, errors: [{ code: 5035, message: 'Paid plan required' }] }, { status: 403 }));
  await expect(streamWorkersAi(messages, () => {})).rejects.toMatchObject({ code: 'AI_MODEL_REQUIRES_PAID' });
});

test.each([
  ['empty stream', 'data: [DONE]\n\n'],
  ['interrupted answer', 'data: {"response":"Partial"}\n\n'],
  ['malformed event', 'data: {oops}\n\ndata: [DONE]\n\n'],
  ['stream error', 'data: {"error":"Inference failed"}\n\ndata: [DONE]\n\n'],
])('%s is not returned as a successful answer', async (_name, payload) => {
  fetchSpy.mockResolvedValue(stream(payload));
  await expect(streamWorkersAi(messages, () => {})).rejects.toMatchObject({ statusCode: 502 });
});
