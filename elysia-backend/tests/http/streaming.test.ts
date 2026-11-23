import { expect, test } from 'bun:test';
import { eventStream } from '../../src/http/event-stream';
import { HttpError } from '../../src/http/errors';
import { limitedRequestBody } from '../../src/http/limited-body';

const payload = (chunks: string[], headers?: RequestInit['headers']) => new Request('http://localhost/upload', {
  method: 'POST', headers,
  body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }),
});

test('body limits count streamed bytes without trusting Content-Length', async () => {
  await expect(limitedRequestBody(payload(['123', '456']), 5)).rejects.toBeInstanceOf(HttpError);
  await expect(limitedRequestBody(payload(['123456'], { 'Content-Length': '1' }), 5)).rejects.toMatchObject({ status: 413 });
  await expect(limitedRequestBody(payload(['ééé']), 5)).rejects.toMatchObject({ status: 413 });
  const accepted = await limitedRequestBody(payload(['{"ok":', 'true}']), 20);
  expect(await accepted.json()).toEqual({ ok: true });
});

test('SSE preserves event framing and completion', async () => {
  async function* events() { yield { type: 'delta', text: 'hello\nworld' }; yield { type: 'status', text: 'ready' }; }
  const iterator = events();
  const controller = new AbortController();
  const response = eventStream({ iterator, first: await iterator.next(), signal: controller.signal, abort: () => controller.abort(), errorBody: () => ({ error: 'failed' }) });
  expect(response.headers.get('Content-Type')).toStartWith('text/event-stream');
  expect(await response.text()).toBe('event: delta\ndata: {"type":"delta","text":"hello\\nworld"}\n\nevent: status\ndata: {"type":"status","text":"ready"}\n\nevent: done\ndata: {}\n\n');
});

test('SSE cancellation aborts upstream work and closes the iterator', async () => {
  const controller = new AbortController();
  let released = false;
  async function* events() {
    try {
      yield { type: 'delta', text: 'start' };
      await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    } finally { released = true; }
  }
  const iterator = events();
  const response = eventStream({ iterator, first: await iterator.next(), signal: controller.signal, abort: () => controller.abort(), errorBody: () => ({ error: 'failed' }) });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await Bun.sleep(0);
  expect(controller.signal.aborted).toBe(true);
  expect(released).toBe(true);
});

test('SSE reports a mid-stream failure without exposing a stack', async () => {
  async function* events() { yield { type: 'delta' }; throw new Error('private detail'); }
  const iterator = events();
  const controller = new AbortController();
  const response = eventStream({ iterator, first: await iterator.next(), signal: controller.signal, abort: () => controller.abort(), errorBody: () => ({ error: 'Reply failed', code: 'INTERNAL' }) });
  const text = await response.text();
  expect(text).toContain('event: error\ndata: {"error":"Reply failed","code":"INTERNAL"}');
  expect(text).not.toContain('private detail');
  expect(text).not.toContain('event: done');
});
