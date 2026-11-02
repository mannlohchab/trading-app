import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoApi } from '../src/lib/demoData.ts';

test('community demo exposes follow state, saved feed and pagination', async () => {
  const demo = createDemoApi();
  const page = await demo.request('/api/community/feed?limit=2');
  assert.equal(page.posts.length, 2);
  assert.equal(page.hasMore, true);
  const post = page.posts[0];
  assert.equal(post.following, true);
  await demo.request(`/api/community/users/${post.author.id}/follow`, { method: 'POST' });
  assert.equal((await demo.request(`/api/community/posts/${post.id}`)).post.following, false);
  const saved = await demo.request('/api/community/feed?tab=saved');
  assert.ok(saved.posts.length); assert.ok(saved.posts.every(p => p.bookmarked));
});

test('community demo preserves post images and validates replies and empty content', async () => {
  const demo = createDemoApi();
  const { post } = await demo.request('/api/community/posts', { method: 'POST', body: { content: ' Image ', imageUrl: 'data:image/png;base64,abc' } });
  assert.equal(post.content, 'Image'); assert.equal(post.imageUrl, 'data:image/png;base64,abc');
  await assert.rejects(demo.request('/api/community/posts', { method: 'POST', body: { content: ' ' } }));
  await assert.rejects(demo.request(`/api/community/posts/${post.id}/comments`, { method: 'POST', body: { content: 'Reply', parentId: 'missing' } }));
  assert.equal((await demo.request(`/api/community/posts/${post.id}`)).post.commentCount, 0);
});

test('community mutations invalidate every feed, post detail and profile count without touching markets', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const { refreshCommunity } = await import('../src/lib/community.ts');
  const client = new QueryClient();
  const keys = [['feed', 'viewer', 'foryou'], ['feed', 'viewer', 'following'], ['feed', 'viewer', 'saved'], ['post', 'viewer', 'post-id'], ['profile-overview', 'viewer']];
  for (const key of [...keys, ['market']]) client.setQueryData(key, { sample: true });
  await refreshCommunity(client);
  for (const key of keys) assert.equal(client.getQueryState(key).isInvalidated, true);
  assert.equal(client.getQueryState(['market']).isInvalidated, false);
  client.clear();
});
