import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

assert.equal(process.env.DATABASE_URL, ':memory:');
const { sqlite } = await import('../../src/db');
await import('../../src/db/migrate');
const { config } = await import('../../src/lib/config');
const { aiRouter } = await import('../../src/modules/ai/routes');
const scenario = process.argv[2];
config.cloudflare.accountId = 'test-account';
config.cloudflare.apiToken = scenario === 'missing-config' ? '' : 'test-token';
sqlite.run("INSERT INTO users(id,email,username,password_hash) VALUES('test-user','test@example.invalid','test','unused')");
sqlite.run("INSERT INTO ai_conversations(id,user_id,title) VALUES('chat','test-user','Test')");
for (let i = 0; i < 30; i++) {
  sqlite.run('INSERT INTO ai_messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)',
    [`message-${i}`, 'chat', i % 2 ? 'assistant' : 'user', `Old message ${i}`, '2020-01-01 00:00:00']);
}
let sent: any;
globalThis.fetch = (async (_url, options) => {
  sent = JSON.parse(options!.body as string);
  if (scenario === 'disconnect') {
    res.emit('close');
    assert.equal(options!.signal!.aborted, true);
    options!.signal!.throwIfAborted();
  }
  if (scenario === 'quota') return Response.json({ success: false, errors: [{ code: 3036, message: 'Account limited' }] }, { status: 429 });
  return new Response('data: {"response":"Test answer"}\n\ndata: [DONE]\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}) as typeof fetch;
const route = aiRouter.stack.find((layer: any) => layer.route?.path === '/chat')!.route;
const handler = route.stack.at(-1).handle;
const res = Object.assign(new EventEmitter(), {
  headersSent: false, writableEnded: false, destroyed: false, output: '',
  setHeader() {},
  flushHeaders() { this.headersSent = true; },
  write(text: string) { this.output += text; return true; },
  end() { this.writableEnded = true; },
});
const req = Object.assign(new EventEmitter(), {
  body: { conversationId: 'chat', message: 'My newest question', kind: 'chat' },
  user: { userId: 'test-user' },
});
let forwarded: any;
await handler(req, res, (error: any) => { forwarded = error; });
if (scenario === 'disconnect') {
  assert.equal(forwarded, undefined);
  assert.equal(res.output.includes('"type":"done"'), false);
  assert.equal(sqlite.query('SELECT COUNT(*) AS n FROM ai_messages').get().n, 31);
  assert.equal(res.listenerCount('close'), 0);
} else if (scenario === 'missing-config') {
  assert.equal(forwarded?.statusCode, 503);
  assert.equal(res.headersSent, false);
  assert.equal(sqlite.query('SELECT COUNT(*) AS n FROM ai_messages').get().n, 30);
} else if (scenario === 'quota') {
  assert.equal(forwarded, undefined, 'stream errors must be sent as SSE, not forwarded to JSON middleware');
  const events = res.output.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
  assert.equal(events.at(-1).type, 'error');
  assert.match(events.at(-1).message, /00:00 UTC/);
  assert.equal(res.writableEnded, true);
  assert.equal(sqlite.query('SELECT COUNT(*) AS n FROM ai_messages').get().n, 31);
} else {
  assert.equal(forwarded, undefined);
  assert.equal(sent.messages.at(-1).content, 'My newest question');
  assert.equal(sent.messages[0].role, 'system');
  assert.equal(sent.messages.some((m: any) => m.content === 'Old message 0'), false);
  assert.ok(sent.messages.some((m: any) => m.content === 'Old message 29'));
  assert.ok(res.output.includes('"type":"done"'));
  assert.equal(sqlite.query('SELECT COUNT(*) AS n FROM ai_messages').get().n, 32);
}
sqlite.close();
