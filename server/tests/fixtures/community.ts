import assert from 'node:assert/strict';
assert.equal(process.env.DATABASE_URL, ':memory:');
const { sqlite } = await import('../../src/db');
await import('../../src/db/migrate');
const { communityRouter } = await import('../../src/modules/community/routes');
const { signAccessToken } = await import('../../src/middleware/auth');
sqlite.run("INSERT INTO users(id,email,username,password_hash) VALUES('viewer','v@example.invalid','viewer','x'),('author','a@example.invalid','author','x')");
const token = signAccessToken({ userId: 'viewer', email: 'v@example.invalid', username: 'viewer' });
async function call(path: string, method: string, { params = {}, query = {}, body = {}, authenticated = true } = {} as any) {
  const route = communityRouter.stack.find((l: any) => l.route?.path === path && l.route.methods[method])!.route;
  const req = { params, query, body, headers: authenticated ? { authorization: `Bearer ${token}` } : {} };
  let result: any; let error: any; let status = 200;
  const res = { status(code: number) { status = code; return this; }, json(value: any) { result = value; return this; } };
  for (const layer of route.stack) {
    let proceed = false;
    try { await layer.handle(req, res, (err: any) => { error = err; proceed = !err; }); } catch (err) { error = err; }
    if (!proceed || error) break;
  }
  return { result, error, status };
}
sqlite.run("INSERT INTO posts(id,user_id,content,is_editors_pick) VALUES('p1','author','First',1),('p2','author','Second',0)");
const feed = () => call('/feed', 'get', { query: { tab: 'foryou' } });
assert.equal((await feed()).result.posts[0].following, false);
assert.deepEqual((await call('/users/:id/follow', 'post', { params: { id: 'author' } })).result, { following: true });
assert.equal((await feed()).result.posts[0].following, true);
assert.equal((await call('/feed', 'get', { query: { tab: 'following' } })).result.posts.length, 2);
await call('/users/:id/follow', 'post', { params: { id: 'author' } });
assert.equal((await call('/feed', 'get', { query: { tab: 'following' } })).result.posts.length, 0);
await call('/posts/:id/bookmark', 'post', { params: { id: 'p1' } });
assert.deepEqual((await call('/feed', 'get', { query: { tab: 'saved' } })).result.posts.map((p: any) => p.id), ['p1']);
assert.equal((await call('/feed', 'get', { query: { tab: 'saved' }, authenticated: false })).error?.statusCode, 401);
assert.equal((await call('/feed', 'get', { query: { offset: -1 } })).error?.statusCode, 400);
const page = (await call('/feed', 'get', { query: { limit: 1 } })).result;
assert.equal(page.posts.length, 1); assert.equal(page.hasMore, true);
assert.equal((await call('/feed', 'get', { query: { limit: 1, offset: 1 } })).result.hasMore, false);
for (const liked of [true, false]) {
  assert.equal((await call('/posts/:id/like', 'post', { params: { id: 'p1' } })).result.liked, liked);
  assert.equal((await call('/posts/:id', 'get', { params: { id: 'p1' } })).result.post.likeCount, liked ? 1 : 0);
}
assert.ok((await call('/posts', 'post', { body: { content: '  ' } })).error);
const created = await call('/posts', 'post', { body: { content: '  New idea  ', imageUrl: 'data:image/png;base64,abc', symbol: 'EURUSD' } });
assert.equal(created.status, 201); assert.equal(created.result.post.content, 'New idea');
assert.equal(created.result.post.imageUrl, 'data:image/png;base64,abc');
assert.equal(created.result.post.symbol, 'EUR/USD');
const comment = await call('/posts/:id/comments', 'post', { params: { id: 'p1' }, body: { content: ' Hello ' } });
assert.equal(comment.status, 201);
const reply = await call('/posts/:id/comments', 'post', { params: { id: 'p1' }, body: { content: 'Reply', parentId: comment.result.comment.id } });
assert.equal(reply.status, 201);
assert.equal((await call('/posts/:id/comments', 'post', { params: { id: 'p2' }, body: { content: 'Wrong post', parentId: comment.result.comment.id } })).error?.statusCode, 400);
const detail = (await call('/posts/:id', 'get', { params: { id: 'p1' } })).result;
assert.equal(detail.comments.length, 2); assert.equal(detail.post.commentCount, 2);
assert.equal(detail.comments.find((c: any) => c.id === comment.result.comment.id).content, 'Hello');
assert.equal((await call('/posts/:id/report', 'post', { params: { id: 'p1' }, body: { reason: 'Spam content' } })).result.ok, true);
assert.equal((await call('/posts', 'post', { authenticated: false, body: { content: 'No' } })).error?.statusCode, 401);
