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

describe('morning decode', () => {
  test('returns shared metadata once per UTC day without transcript; audio optional without TTS keys', async () => {
    const first = await c.get('/api/v1/ai/morning-decode');
    expect(first.status).toBe(200);
    expect(first.body.title).toBe('Morning Decode');
    expect(first.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.body.hasAudio).toBe(false);
    expect(first.body.available).toBe(false);
    expect(first.body.disclaimer).toMatch(/not investment advice/i);
    expect(first.body.content).toBeUndefined();
    expect(typeof first.body.sessionLabel).toBe('string');

    const second = await c.get('/api/v1/ai/morning-decode');
    expect(second.body.date).toBe(first.body.date);
    expect(second.body.generatedAt).toBe(first.body.generatedAt);
    expect(await t.db.select().from(aiMarketBriefs)).toHaveLength(1);

    expect((await c.get('/api/v1/ai/morning-decode/audio')).status).toBe(404);

    // Legacy aliases for older clients
    const legacy = await c.get('/api/v1/ai/daily-brief');
    expect(legacy.status).toBe(200);
    expect(legacy.body.title).toBe('Morning Decode');
    expect(legacy.body.content).toBeUndefined();
  });

  test('requires an active user', async () => {
    expect((await client(t.app).get('/api/v1/ai/morning-decode')).status).toBe(401);
    expect((await (await pendingUser(t)).c.get('/api/v1/ai/morning-decode')).status).toBe(403);
  });
});
