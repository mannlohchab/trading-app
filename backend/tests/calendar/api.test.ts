import { afterAll, beforeAll, expect, test } from 'bun:test';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
let calls = 0;
beforeAll(async () => {
  t = await createTestApp({ calendarRequest: async () => {
    calls++;
    return Response.json([{ title: 'CPI', country: 'USD', date: '2026-11-23T08:30:00-05:00', impact: 'High', previous: '0', forecast: '' }]);
  } });
});
afterAll(() => t?.close());

test('calendar is on the app API and requires an active session before contacting the provider', async () => {
  expect((await client(t.app).get('/api/v1/calendar')).status).toBe(401);
  expect((await (await pendingUser(t)).c.get('/api/v1/calendar')).status).toBe(403);
  expect(calls).toBe(0);
  const user = await activeUser(t);
  const result = await user.c.get('/api/v1/calendar');
  expect(result.status).toBe(200);
  expect(result.body.items[0]).toMatchObject({ event: 'CPI', previous: '0', forecast: null });
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  await user.c.get('/api/v1/calendar');
  expect(calls).toBe(1);
});
