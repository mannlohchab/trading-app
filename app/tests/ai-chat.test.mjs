import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeAiStream, createAiRequestGate } from '../src/lib/aiChat.ts';

function stream(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } });
}

test('stream preserves split UTF-8 tokens and accepts a final event without a newline', async () => {
  const events = [];
  await consumeAiStream(stream('data: {"type":"meta","conversationId":"one"}\r\n\r\ndata: {"type":"token","content":"$100"}\n\ndata: {"type":"done"}'), event => events.push(event));
  assert.deepEqual(events, [
    { type: 'meta', conversationId: 'one' }, { type: 'token', content: '$100' }, { type: 'done' },
  ]);
});

test('interrupted responses preserve delivered tokens but report incomplete completion', async () => {
  const events = [];
  await assert.rejects(consumeAiStream(stream('data: {"type":"token","content":"Partial"}\n\n'), event => events.push(event)), /interrupted/i);
  assert.deepEqual(events, [{ type: 'token', content: 'Partial' }]);
});

test('server errors and consumer errors are not silently swallowed', async () => {
  await assert.rejects(consumeAiStream(stream('data: {"type":"error","message":"AI unavailable"}\n\n'), () => {}), /AI unavailable/);
  await assert.rejects(consumeAiStream(stream('data: {"type":"token","content":"Hi"}\n\n'), () => { throw new Error('consumer failed'); }), /consumer failed/);
});

test('request gate blocks double send and rejects stale results after switching conversations', () => {
  const gate = createAiRequestGate();
  const first = gate.begin();
  assert.ok(first);
  assert.equal(gate.begin(), null);
  gate.reset();
  assert.equal(first.signal.aborted, true);
  const next = gate.begin();
  assert.ok(next);
  assert.equal(gate.isCurrent(first), false);
  gate.finish(first);
  assert.equal(gate.begin(), null);
  assert.equal(gate.isCurrent(next), true);
  gate.finish(next);
  assert.ok(gate.begin());
});

test('backend named events: deltas and the saved reply arrive, done ends the stream, errors throw their message', async () => {
  const events = [];
  const body = [
    'event: user_message', 'data: {"type":"user_message","message":{"id":"u1","content":"hi"}}', '',
    'event: delta', 'data: {"type":"delta","text":"Bit"}', '',
    'event: delta', 'data: {"type":"delta","text":"coin ₹"}', '',
    'event: assistant_message', 'data: {"type":"assistant_message","message":{"id":"a1","content":"Bitcoin ₹"}}', '',
    'event: done', 'data: {}', '', '',
  ].join('\n');
  await consumeAiStream(stream(body, 3), event => events.push(event));
  assert.deepEqual(events.map(e => e.type), ['user_message', 'delta', 'delta', 'assistant_message', 'done']);
  assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), 'Bitcoin ₹');
  assert.equal(events[3].message.content, 'Bitcoin ₹');
  await assert.rejects(
    consumeAiStream(stream('event: error\ndata: {"error":"Daily AI limit reached.","code":"QUOTA_EXCEEDED"}\n\n'), () => {}),
    /Daily AI limit reached/,
  );
});
