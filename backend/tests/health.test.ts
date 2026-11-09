import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createTestApp } from './helpers/test-app';

let reachable = true;
let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp({ pingDatabase: async () => reachable }); });
afterAll(() => t.close());

test('GET /health reports the service is up', async () => {
  const res = await t.app.request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: 'trading-backend' });
  expect(res.headers.get('x-request-id')).toBeTruthy();
});

test('GET /health/ready reflects whether Postgres answers', async () => {
  reachable = true;
  expect((await t.app.request('/health/ready')).status).toBe(200);
  reachable = false;
  const res = await t.app.request('/health/ready');
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ ok: false, database: 'down' });
});

test('unknown routes return a JSON 404', async () => {
  const res = await t.app.request('/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Not found' });
});

test('CORS echoes the caller origin so credentialed requests work', async () => {
  const res = await t.app.request('/health', { headers: { Origin: 'http://localhost:8081' } });
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
  expect(res.headers.get('access-control-allow-credentials')).toBe('true');
});
