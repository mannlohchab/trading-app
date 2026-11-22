import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { aiMarketBriefs } from '../../src/db/schema';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
let c: Awaited<ReturnType<typeof activeUser>>['c'];
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  ({ c } = await activeUser(t));
});
afterAll(() => t.close());

describe('daily brief', () => {
  test('returns a cached brief for the UTC day; audio is optional without OpenRouter', async () => {
    const first = await c.get('/api/v1/ai/daily-brief');
    expect(first.status).toBe(200);
    expect(first.body.content.length).toBeGreaterThan(20);
    expect(first.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.body.hasAudio).toBe(false);
    expect(first.body.disclaimer).toMatch(/not investment advice/i);

    const second = await c.get('/api/v1/ai/daily-brief');
    expect(second.body.content).toBe(first.body.content);
    expect(await t.db.select().from(aiMarketBriefs)).toHaveLength(1);

    expect((await c.get('/api/v1/ai/daily-brief/audio')).status).toBe(404);
  });

  test('requires an active user', async () => {
    expect((await client(t.app).get('/api/v1/ai/daily-brief')).status).toBe(401);
    expect((await (await pendingUser(t)).c.get('/api/v1/ai/daily-brief')).status).toBe(403);
  });
});
