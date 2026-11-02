import assert from 'node:assert/strict';

assert.equal(process.env.DATABASE_URL, ':memory:');
const { sqlite } = await import('../../src/db');
await import('../../src/db/migrate');
const { aiRouter } = await import('../../src/modules/ai/routes');

sqlite.run("INSERT INTO users(id,email,username,password_hash) VALUES('owner','o@example.invalid','owner','x'),('other','x@example.invalid','other','x')");
sqlite.run("INSERT INTO ai_conversations(id,user_id,title) VALUES('mine','owner','Mine'),('theirs','other','Theirs')");
sqlite.run("INSERT INTO ai_messages(id,conversation_id,role,content) VALUES('m1','mine','user','hi'),('m2','mine','assistant','hello'),('t1','theirs','user','private')");

const route = aiRouter.stack.find((layer: any) => layer.route?.path === '/conversations/:id' && layer.route.methods.delete)!.route;
async function remove(id: string, userId: string) {
  let body: unknown; let error: any;
  await route.stack.at(-1).handle({ params: { id }, user: { userId } } as any, { json: (b: unknown) => { body = b; } } as any, (e: any) => { error = e; });
  return { body, error };
}
const count = (sql: string) => (sqlite.query(sql).get() as { n: number }).n;

// Another user cannot delete (or detect) someone else's conversation.
const denied = await remove('theirs', 'owner');
assert.equal(denied.error?.statusCode, 404);
assert.equal(count("SELECT COUNT(*) AS n FROM ai_conversations WHERE id='theirs'"), 1);

// The owner's delete removes the conversation and cascades its messages only.
assert.deepEqual((await remove('mine', 'owner')).body, { ok: true });
assert.equal(count("SELECT COUNT(*) AS n FROM ai_conversations WHERE id='mine'"), 0);
assert.equal(count("SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id='mine'"), 0);
assert.equal(count("SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id='theirs'"), 1);

// Deleting again reports not found.
assert.equal((await remove('mine', 'owner')).error?.statusCode, 404);
