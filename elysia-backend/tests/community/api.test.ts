import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { communityPosts, users } from '../../src/db/schema';
import { AUTO_HIDE_REPORTS, RATE_LIMITS } from '../../src/modules/community/domain/rules';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const BASE = '/api/v1/community';

let t: Awaited<ReturnType<typeof createTestApp>>;
let asha: Awaited<ReturnType<typeof activeUser>>;
let ravi: Awaited<ReturnType<typeof activeUser>>;

beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  asha = await activeUser(t, 'Asha Trader');
  ravi = await activeUser(t, 'Ravi Analyst');
});
afterAll(() => t.close());

const publish = async (who: typeof asha, body: Record<string, unknown>) => {
  const res = await who.c.post(`${BASE}/posts`, body);
  expect(res.status).toBe(201);
  return res.body.post;
};

describe('access', () => {
  test('requires a signed-in, phone-verified user', async () => {
    expect((await client(t.app).get(`${BASE}/feed`)).status).toBe(401);
    const pending = await pendingUser(t);
    expect((await pending.c.get(`${BASE}/feed`)).status).toBe(403);
  });
});

describe('posts', () => {
  test('publishing a finding tagged with a pair in any spelling', async () => {
    const post = await publish(asha, { content: '  BTC reclaimed the 200-day MA.\r\nWatching 75k.  ', symbol: 'btc/usdt' });
    expect(post).toMatchObject({
      content: 'BTC reclaimed the 200-day MA.\nWatching 75k.', symbol: 'BTCUSDT', exchange: 'BINANCE',
      likeCount: 0, commentCount: 0, liked: false, bookmarked: false, following: false, isOwn: true, isEditorsPick: false, imageUrl: null,
      author: { id: asha.user.id, displayName: 'Asha Trader' },
    });
  });

  test('validation errors name the field', async () => {
    expect((await asha.c.post(`${BASE}/posts`, { content: '   ' })).body.fields).toEqual({ content: "Post can't be empty." });
    expect((await asha.c.post(`${BASE}/posts`, { content: 'x'.repeat(5001) })).body.fields.content).toContain('5000');
    expect((await asha.c.post(`${BASE}/posts`, { content: 'hi', symbol: 'NOPEUSDT' })).body.fields.symbol).toContain('Unknown');
  });

  test('images are stored, served publicly with their sniffed type, and SVG is refused', async () => {
    const post = await publish(ravi, { content: 'Chart attached', imageUrl: `data:image/png;base64,${PNG}` });
    expect(post.imageUrl).toStartWith('http://localhost:4001/api/v1/community-images/');
    const res = await t.app.request(new URL(post.imageUrl).pathname);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).toString('base64')).toBe(PNG);

    const svg = await ravi.c.post(`${BASE}/posts`, { content: 'x', image: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` });
    expect(svg.status).toBe(400);
  });

  test('only the author can edit or delete', async () => {
    const post = await publish(asha, { content: 'ETH looks weak' });
    expect((await ravi.c.patch(`${BASE}/posts/${post.id}`, { content: 'hacked' })).status).toBe(403);
    expect((await ravi.c.delete(`${BASE}/posts/${post.id}`)).status).toBe(403);
    const edited = await asha.c.patch(`${BASE}/posts/${post.id}`, { content: 'ETH looks weak below 2k' });
    expect(edited.body.post).toMatchObject({ content: 'ETH looks weak below 2k' });
    expect(edited.body.post.editedAt).not.toBeNull();
    expect((await asha.c.delete(`${BASE}/posts/${post.id}`)).status).toBe(204);
    expect((await asha.c.get(`${BASE}/posts/${post.id}`)).status).toBe(404);
  });

  test('unknown ids are 404, not 500', async () => {
    expect((await asha.c.get(`${BASE}/posts/not-a-uuid`)).status).toBe(404);
    expect((await asha.c.put(`${BASE}/posts/00000000-0000-4000-8000-000000000000/like`)).status).toBe(404);
  });
});

describe('interactions', () => {
  test('likes are idempotent and counted by the database', async () => {
    const post = await publish(asha, { content: 'SOL breakout?' });
    expect((await ravi.c.put(`${BASE}/posts/${post.id}/like`)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await ravi.c.put(`${BASE}/posts/${post.id}/like`)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await asha.c.put(`${BASE}/posts/${post.id}/like`)).body).toEqual({ liked: true, likeCount: 2 });
    expect((await ravi.c.delete(`${BASE}/posts/${post.id}/like`)).body).toEqual({ liked: false, likeCount: 1 });
    expect((await ravi.c.delete(`${BASE}/posts/${post.id}/like`)).body).toEqual({ liked: false, likeCount: 1 });
  });

  test('comments, replies and deletion keep the count right', async () => {
    const post = await publish(asha, { content: 'Fed day plan' });
    const first = (await ravi.c.post(`${BASE}/posts/${post.id}/comments`, { content: 'Staying flat' })).body.comment;
    const reply = await asha.c.post(`${BASE}/posts/${post.id}/comments`, { content: 'Same', parentId: first.id });
    expect(reply.status).toBe(201);
    expect(reply.body.comment).toMatchObject({ parentId: first.id, isOwn: true });

    // A reply must point at a comment on the same post.
    const other = await publish(ravi, { content: 'Other post' });
    expect((await asha.c.post(`${BASE}/posts/${other.id}/comments`, { content: 'x', parentId: first.id })).status).toBe(400);

    let detail = (await asha.c.get(`${BASE}/posts/${post.id}`)).body;
    expect(detail.post.commentCount).toBe(2);
    expect(detail.comments.map((c: any) => c.content)).toEqual(['Staying flat', 'Same']);

    // The post's author may remove a comment on their post; its replies go with it.
    expect((await asha.c.delete(`${BASE}/comments/${first.id}`)).status).toBe(204);
    detail = (await asha.c.get(`${BASE}/posts/${post.id}`)).body;
    expect(detail.post.commentCount).toBe(0);
    expect(detail.comments).toEqual([]);
  });

  test('a stranger cannot delete someone else’s comment', async () => {
    const post = await publish(ravi, { content: 'Gold vs BTC' });
    const comment = (await ravi.c.post(`${BASE}/posts/${post.id}/comments`, { content: 'mine' })).body.comment;
    const carol = await activeUser(t, 'Carol');
    expect((await carol.c.delete(`${BASE}/comments/${comment.id}`)).status).toBe(403);
  });

  test('following and the Following feed', async () => {
    const dev = await activeUser(t, 'Dev Follower');
    expect((await dev.c.put(`${BASE}/users/${dev.user.id}/follow`)).status).toBe(400);
    expect((await dev.c.get(`${BASE}/feed?tab=following`)).body.posts).toEqual([]);
    expect((await dev.c.put(`${BASE}/users/${ravi.user.id}/follow`)).body).toEqual({ following: true });
    const feed = (await dev.c.get(`${BASE}/feed?tab=following`)).body.posts;
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((p: any) => p.author.id === ravi.user.id && p.following)).toBe(true);
    const profile = (await dev.c.get(`${BASE}/users/${ravi.user.id}`)).body;
    expect(profile).toMatchObject({ following: true, followerCount: 1, user: { id: ravi.user.id, displayName: 'Ravi Analyst', isOwn: false } });
    expect((await dev.c.delete(`${BASE}/users/${ravi.user.id}/follow`)).body).toEqual({ following: false });
  });

  test('saved posts feed, newest save first', async () => {
    const eve = await activeUser(t, 'Eve Saver');
    const a = await publish(asha, { content: 'save me first' });
    const b = await publish(asha, { content: 'save me second' });
    await eve.c.put(`${BASE}/posts/${b.id}/bookmark`);
    await eve.c.put(`${BASE}/posts/${a.id}/bookmark`);
    const saved = (await eve.c.get(`${BASE}/feed?tab=saved`)).body.posts;
    expect(saved.map((p: any) => p.id)).toEqual([a.id, b.id]);
    expect(saved.every((p: any) => p.bookmarked)).toBe(true);
  });
});

describe('feeds', () => {
  test('cursor pagination walks every post once, newest first', async () => {
    const author = await activeUser(t, 'Pager');
    for (let i = 0; i < 5; i++) await publish(author, { content: `idea ${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: any = await author.c.get(`${BASE}/feed?author=${author.user.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.posts.map((p: any) => p.content));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['idea 4', 'idea 3', 'idea 2', 'idea 1', 'idea 0']);
    expect((await author.c.get(`${BASE}/feed?cursor=garbage`)).status).toBe(400);
  });

  test('filter by instrument and editors’ picks', async () => {
    const pick = await publish(ravi, { content: 'ETH/BTC ratio bottoming', symbol: 'ETHBTC' });
    await t.db.update(communityPosts).set({ isEditorsPick: true }).where(eq(communityPosts.id, pick.id));
    const bySymbol = (await asha.c.get(`${BASE}/feed?symbol=eth-btc`)).body.posts;
    expect(bySymbol.map((p: any) => p.id)).toEqual([pick.id]);
    const editors = (await asha.c.get(`${BASE}/feed?tab=editors`)).body.posts;
    expect(editors.map((p: any) => p.id)).toEqual([pick.id]);
    expect(editors[0].isEditorsPick).toBe(true);
  });

  test('posts by deleted accounts disappear', async () => {
    const gone = await activeUser(t, 'Leaving Soon');
    const post = await publish(gone, { content: 'bye' });
    await t.db.update(users).set({ status: 'DELETED', deletedAt: new Date() }).where(eq(users.id, gone.user.id));
    expect((await asha.c.get(`${BASE}/posts/${post.id}`)).status).toBe(404);
    expect((await asha.c.get(`${BASE}/feed`)).body.posts.some((p: any) => p.id === post.id)).toBe(false);
  });
});

describe('moderation and limits', () => {
  test(`a post reported by ${AUTO_HIDE_REPORTS} people is hidden from everyone but its author`, async () => {
    const post = await publish(ravi, { content: 'Guaranteed 100x, DM me', imageUrl: `data:image/png;base64,${PNG}` });
    expect((await ravi.c.post(`${BASE}/posts/${post.id}/report`, { reason: 'Spam' })).status).toBe(400);
    const reporters = await Promise.all(Array.from({ length: AUTO_HIDE_REPORTS }, (_, i) => activeUser(t, `Reporter ${i}`)));
    for (const r of reporters.slice(0, -1)) expect((await r.c.post(`${BASE}/posts/${post.id}/report`, { reason: 'Spam' })).status).toBe(201);
    // Reporting twice counts once.
    await reporters[0]!.c.post(`${BASE}/posts/${post.id}/report`, { reason: 'Misleading content' });
    expect((await asha.c.get(`${BASE}/posts/${post.id}`)).status).toBe(200);

    await reporters.at(-1)!.c.post(`${BASE}/posts/${post.id}/report`, { reason: 'SPAM' });
    expect((await asha.c.get(`${BASE}/posts/${post.id}`)).status).toBe(404);
    expect((await t.app.request(new URL(post.imageUrl).pathname)).status).toBe(404);
    expect((await ravi.c.get(`${BASE}/posts/${post.id}`)).body.post.hidden).toBe(true);
  });

  test(`at most ${RATE_LIMITS.postsPerHour} posts an hour`, async () => {
    const spammer = await activeUser(t, 'Busy Poster');
    for (let i = 0; i < RATE_LIMITS.postsPerHour; i++) await publish(spammer, { content: `post ${i}` });
    const res = await spammer.c.post(`${BASE}/posts`, { content: 'one more' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  test('oversized bodies are refused before parsing', async () => {
    const res = await asha.c.post(`${BASE}/posts/00000000-0000-4000-8000-000000000000/comments`, { content: 'x'.repeat(40_000) });
    expect(res.status).toBe(413);
  });

  test('deleting a user removes their likes and fixes the counts', async () => {
    const post = await publish(asha, { content: 'count check' });
    const fan = await activeUser(t, 'Short-lived Fan');
    await fan.c.put(`${BASE}/posts/${post.id}/like`);
    await fan.c.post(`${BASE}/posts/${post.id}/comments`, { content: 'nice' });
    await t.db.delete(users).where(eq(users.id, fan.user.id));
    const detail = (await asha.c.get(`${BASE}/posts/${post.id}`)).body.post;
    expect([detail.likeCount, detail.commentCount]).toEqual([0, 0]);
  });
});
