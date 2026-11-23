import { expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { z } from 'zod';
import { createApp, type AppDeps } from '../src/app';
import { HttpError } from '../src/http/errors';
import { parseJson } from '../src/http/validation';

const origin = 'https://app.example.com';

/** Exercise the real HTTP shell without database or provider work. */
function fixture(clientOrigin: AppDeps['clientOrigin'] = [origin], metrics?: AppDeps['metrics']) {
  let guardCalls = 0;
  const protectedRoutes = new Elysia()
    .resolve(({ request }) => {
      guardCalls++;
      if (request.headers.get('authorization') !== 'Bearer test-session') {
        throw new HttpError(401, { error: 'Sign in to continue.', code: 'UNAUTHENTICATED' });
      }
      return { user: { id: 'test-user' } };
    })
    .get('/guarded', ({ user }) => ({ id: user.id }))
    .post('/guarded/json', async ({ request }) => {
      const parsed = await parseJson(request, z.strictObject({ name: z.string().min(1) }));
      return 'response' in parsed ? parsed.response : parsed.data;
    }, { parse: 'none' });
  const empty = () => ({ routes: new Elysia() });
  // Only routes are consumed by createApp; services are irrelevant to these shell tests.
  const deps = {
    clientOrigin,
    metrics,
    pingDatabase: async () => true,
    identity: { routes: new Elysia().get('/public-before', () => ({ ok: true })) },
    profiles: { routes: protectedRoutes },
    market: { routes: new Elysia().get('/public-after', () => ({ ok: true })) },
    strategies: empty(),
    ai: empty(),
    backtesting: empty(),
    paperTrading: empty(),
    news: empty(),
    community: empty(),
    portfolio: empty(),
    calendar: { routes: new Elysia()
      .get('/unexpected-error', () => { throw new Error('database password: private-secret'); })
      .get('/expected-error', () => { throw new HttpError(409, { error: 'Conflict', code: 'CONFLICT' }); }) },
  } as unknown as AppDeps;
  const app = createApp(deps);
  return {
    request: (path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init)),
    guardCalls: () => guardCalls,
  };
}

test('CORS permits configured credentialed origins and omits permission for other origins', async () => {
  const app = fixture();
  const allowed = await app.request('/public-after', { headers: { Origin: origin } });
  expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
  expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
  expect(allowed.headers.get('access-control-expose-headers')).toContain('set-auth-token');
  expect(allowed.headers.get('vary')).toContain('Origin');
  const denied = await app.request('/public-after', { headers: { Origin: 'https://untrusted.example' } });
  expect(denied.headers.has('access-control-allow-origin')).toBe(false);
  expect((await app.request('/public-after')).headers.has('access-control-allow-origin')).toBe(false);
  const open = await fixture('*').request('/public-after', { headers: { Origin: origin } });
  expect(open.headers.get('access-control-allow-origin')).toBe(origin);
});

test('preflight completes before authentication, including unknown paths', async () => {
  const app = fixture();
  for (const path of ['/guarded/json', '/not-a-route']) {
    const response = await app.request(path, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type,Idempotency-Key' },
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  }
  expect(app.guardCalls()).toBe(0);
});

test('authentication stays local to protected module routes', async () => {
  const app = fixture();
  for (const path of ['/health', '/public-before', '/public-after']) {
    expect((await app.request(path)).status).toBe(200);
  }
  expect(app.guardCalls()).toBe(0);
  const denied = await app.request('/guarded');
  expect(denied.status).toBe(401);
  expect(await denied.json()).toEqual({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' });
  const allowed = await app.request('/guarded', { headers: { Authorization: 'Bearer test-session' } });
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ id: 'test-user' });
  expect(app.guardCalls()).toBe(2);
  expect((await app.request('/missing')).status).toBe(404);
  expect(app.guardCalls()).toBe(2);
});

test('raw JSON parsing retains authentication order and validation response contracts', async () => {
  const app = fixture();
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' };
  const denied = await app.request('/guarded/json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  expect(denied.status).toBe(401);
  const malformed = await app.request('/guarded/json', { method: 'POST', headers, body: '{broken' });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: 'Request body must be JSON.', code: 'INVALID_JSON' });
  const invalid = await app.request('/guarded/json', { method: 'POST', headers, body: '{}' });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: 'Some fields are invalid.', code: 'VALIDATION_ERROR', fields: { name: expect.any(String) } });
  const valid = await app.request('/guarded/json', { method: 'POST', headers, body: '{"name":"Asha"}' });
  expect(valid.status).toBe(200);
  expect(await valid.json()).toEqual({ name: 'Asha' });
});

test('global errors are sanitized and keep request, CORS and security headers', async () => {
  const app = fixture();
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await app.request('/unexpected-error', { headers: { Origin: origin, 'X-Request-Id': 'review-123' } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(response.headers.get('x-request-id')).toBe('review-123');
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
  const expected = await app.request('/expected-error');
  expect(expected.status).toBe(409);
  expect(await expected.json()).toEqual({ error: 'Conflict', code: 'CONFLICT' });
  expect(expected.headers.get('x-request-id')).toBeTruthy();
  const missing = await app.request('/missing', { headers: { 'X-Request-Id': 'invalid request id' } });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'Not found' });
  expect(missing.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
  expect(missing.headers.get('x-frame-options')).toBe('SAMEORIGIN');
});


test('metrics retain statuses for authentication, preflight and errors without raw-path labels', async () => {
  const records: { method: string; route: string; status: number }[] = [];
  const app = fixture([origin], { recordHttp: (method, route, status) => { records.push({ method, route, status }); } });
  await app.request('/guarded');
  await app.request('/guarded/json', { method: 'OPTIONS' });
  await app.request('/expected-error');
  await app.request('/missing-unique-path');
  await new Promise(resolve => setImmediate(resolve));
  expect(records).toContainEqual({ method: 'GET', route: '/guarded', status: 401 });
  expect(records).toContainEqual({ method: 'OPTIONS', route: 'unmatched', status: 204 });
  expect(records).toContainEqual({ method: 'GET', route: '/expected-error', status: 409 });
  expect(records).toContainEqual({ method: 'GET', route: 'unmatched', status: 404 });
  expect(records).toHaveLength(4);
});
