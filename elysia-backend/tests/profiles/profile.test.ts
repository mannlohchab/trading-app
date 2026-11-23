import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { exchanges, tradingSymbols, userPreferences, users } from '../../src/db/schema';
import { DEFAULT_PREFERENCES } from '../../src/modules/profiles/domain/preferences';
import { toPreferences } from '../../src/modules/profiles/infrastructure/preferences-mapper';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
  const [binance] = await t.db.select().from(exchanges).where(eq(exchanges.code, 'BINANCE'));
  await t.db.insert(tradingSymbols).values([
    { exchangeId: binance!.id, symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', assetType: 'SPOT' },
    { exchangeId: binance!.id, symbol: 'ETHUSDT_PERP', baseAsset: 'ETH', quoteAsset: 'USDT', assetType: 'PERPETUAL' },
    { exchangeId: binance!.id, symbol: 'OLDCOIN', baseAsset: 'OLD', quoteAsset: 'USDT', isActive: false },
  ]);
});
afterAll(() => t.close());

describe('access', () => {
  test('profile and preferences need a signed-in, phone-verified user', async () => {
    expect((await client(t.app).get('/api/v1/me/profile')).status).toBe(401);
    const { c } = await pendingUser(t);
    for (const path of ['/api/v1/me/profile', '/api/v1/me/preferences']) {
      const res = await c.get(path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PHONE_VERIFICATION_REQUIRED');
    }
  });

  test("Better Auth's own update-user and delete-user endpoints are disabled", async () => {
    const { c } = await activeUser(t);
    expect((await c.post('/api/v1/auth/update-user', { name: 'Bypass' })).status).toBe(404);
    expect((await c.post('/api/v1/auth/delete-user', {})).status).toBe(404);
  });
});

describe('profile', () => {
  test('returns the current user with a default timezone', async () => {
    const { c, user, email, phoneNumber } = await activeUser(t, 'Ravi Kumar');
    const res = await c.get('/api/v1/me/profile');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, name: 'Ravi Kumar', username: null, image: null, email, phoneNumber, timezone: 'UTC' });
  });

  test('updates name, username, picture and timezone', async () => {
    const { c, user } = await activeUser(t);
    const res = await c.patch('/api/v1/me/profile', {
      name: '  Priya   Sharma ', username: 'priya_trades', image: 'https://cdn.example.com/p.png', timezone: 'Asia/Kolkata',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Priya Sharma', username: 'priya_trades', image: 'https://cdn.example.com/p.png', timezone: 'Asia/Kolkata' });

    // Timezone is one setting shared with preferences; the session sees the new name.
    expect((await c.get('/api/v1/me/preferences')).body.general.timezone).toBe('Asia/Kolkata');
    expect((await c.get('/api/v1/auth/get-session')).body.user.name).toBe('Priya Sharma');

    // null clears optional fields.
    const cleared = await c.patch('/api/v1/me/profile', { username: null, image: null });
    expect(cleared.body).toMatchObject({ username: null, image: null });
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.username).toBeNull();
  });

  test('usernames are unique regardless of case', async () => {
    const a = await activeUser(t);
    expect((await a.c.patch('/api/v1/me/profile', { username: 'MarketMaven' })).status).toBe(200);
    const b = await activeUser(t);
    const res = await b.c.patch('/api/v1/me/profile', { username: 'marketmaven' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USERNAME_TAKEN');
  });

  test('rejects invalid values field by field', async () => {
    const { c } = await activeUser(t);
    const res = await c.patch('/api/v1/me/profile', { name: '', username: 'no spaces!', image: 'http://insecure.example.com/a.png', timezone: 'Mars/Olympus' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.fields).sort()).toEqual(['image', 'name', 'timezone', 'username']);

    expect((await c.patch('/api/v1/me/profile', { username: 'Admin' })).body.fields.username).toBe('That username is reserved.');
    expect((await c.patch('/api/v1/me/profile', { email: 'x@example.com' })).status).toBe(400); // unknown field
    expect((await c.patch('/api/v1/me/profile', {})).status).toBe(400);
  });
});

describe('preferences', () => {
  test('a new user gets the defaults, and they match the database column defaults', async () => {
    const { c, user } = await activeUser(t);
    expect((await c.get('/api/v1/me/preferences')).body).toEqual(DEFAULT_PREFERENCES);

    await t.db.insert(userPreferences).values({ userId: user.id });
    const [row] = await t.db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
    expect(toPreferences(row!, null, null)).toEqual(DEFAULT_PREFERENCES);
  });

  test('partial updates merge into the saved preferences and are normalized', async () => {
    const { c } = await activeUser(t);
    const res = await c.patch('/api/v1/me/preferences', {
      general: { theme: 'DARK', language: 'hi-in', currency: 'inr' },
      ai: { responseStyle: 'CONCISE', language: 'en-IN' },
    });
    expect(res.status).toBe(200);
    expect(res.body.general).toEqual({ ...DEFAULT_PREFERENCES.general, theme: 'DARK', language: 'hi-IN', currency: 'INR' });
    expect(res.body.ai).toEqual({ responseStyle: 'CONCISE', explanationLevel: 'BEGINNER', language: 'en-IN' });

    await c.patch('/api/v1/me/preferences', { general: { notificationsEnabled: false } });
    const saved = (await c.get('/api/v1/me/preferences')).body;
    expect(saved.general).toMatchObject({ theme: 'DARK', notificationsEnabled: false });
    expect(saved.trading).toEqual(DEFAULT_PREFERENCES.trading);
  });

  test('trading defaults: exchange, pair, market type, timeframe and chart', async () => {
    const { c } = await activeUser(t);
    const res = await c.patch('/api/v1/me/preferences', {
      trading: { exchange: 'binance', tradingPair: 'btcusdt', marketType: 'SPOT', timeframe: '15m', chartType: 'HEIKIN_ASHI' },
    });
    expect(res.status).toBe(200);
    expect(res.body.trading).toEqual({ exchange: 'BINANCE', tradingPair: 'BTCUSDT', marketType: 'SPOT', timeframe: '15m', chartType: 'HEIKIN_ASHI' });
    expect((await c.get('/api/v1/me/preferences')).body.trading.tradingPair).toBe('BTCUSDT');

    // Clearing the exchange also clears its pair.
    const cleared = await c.patch('/api/v1/me/preferences', { trading: { exchange: null } });
    expect(cleared.body.trading).toMatchObject({ exchange: null, tradingPair: null });
  });

  test('rejects pairs that do not exist, are inactive, need an exchange, or are a different market type', async () => {
    const { c } = await activeUser(t);
    const cases: [object, string][] = [
      [{ exchange: 'NASDAQ' }, 'trading.exchange'],
      [{ exchange: 'BINANCE', tradingPair: 'DOGEUSDT' }, 'trading.tradingPair'],
      [{ exchange: 'BINANCE', tradingPair: 'OLDCOIN' }, 'trading.tradingPair'],
      [{ tradingPair: 'BTCUSDT' }, 'trading.tradingPair'],
      [{ exchange: 'BINANCE', tradingPair: 'ETHUSDT_PERP', marketType: 'SPOT' }, 'trading.marketType'],
    ];
    for (const [trading, field] of cases) {
      const res = await c.patch('/api/v1/me/preferences', { trading });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fields)).toContain(field);
    }
    const ok = await c.patch('/api/v1/me/preferences', { trading: { exchange: 'BINANCE', tradingPair: 'ETHUSDT_PERP', marketType: 'PERPETUAL' } });
    expect(ok.status).toBe(200);
  });

  test('rejects unknown options and fields', async () => {
    const { c } = await activeUser(t);
    const bad = await c.patch('/api/v1/me/preferences', {
      general: { theme: 'NEON', timezone: 'Nowhere/City', language: 'not a language' },
      trading: { timeframe: '2h' },
      ai: { explanationLevel: 'GENIUS' },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['general.theme', 'trading.timeframe', 'ai.explanationLevel']));
    expect((await c.patch('/api/v1/me/preferences', { general: { timezone: 'Nowhere/City' } })).body.fields).toHaveProperty(['general.timezone']);
    expect((await c.patch('/api/v1/me/preferences', { general: { language: 'not a language' } })).body.fields).toHaveProperty(['general.language']);
    expect((await c.patch('/api/v1/me/preferences', { extra: {} })).status).toBe(400);
  });

  test('concurrent updates to different sections are both kept', async () => {
    const { c } = await activeUser(t);
    await Promise.all([
      c.patch('/api/v1/me/preferences', { general: { theme: 'LIGHT' } }),
      c.patch('/api/v1/me/preferences', { ai: { explanationLevel: 'ADVANCED' } }),
      c.patch('/api/v1/me/preferences', { trading: { chartType: 'LINE' } }),
    ]);
    const saved = (await c.get('/api/v1/me/preferences')).body;
    expect([saved.general.theme, saved.ai.explanationLevel, saved.trading.chartType]).toEqual(['LIGHT', 'ADVANCED', 'LINE']);
  });
});
