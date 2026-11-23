import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { clientIpResolver, withResolvedClientIp } from '../src/http/client-ip';

const resolveWith = async (header: string | undefined, headers: Record<string, string>) => {
  const app = new Elysia().get('/', c => clientIpResolver(header)(c) ?? 'none');
  return (await app.handle(new Request('http://localhost/', { headers }))).text();
};

test('without a trusted proxy header, client-sent forwarding headers are ignored', async () => {
  expect(await resolveWith(undefined, { 'X-Forwarded-For': '6.6.6.6' })).toBe('none');
});

test('x-forwarded-for uses the address the closest proxy appended', async () => {
  expect(await resolveWith('x-forwarded-for', { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' })).toBe('203.0.113.9');
});

test('single-value proxy headers are used as-is', async () => {
  expect(await resolveWith('cf-connecting-ip', { 'CF-Connecting-IP': '2001:db8::1' })).toBe('2001:db8::1');
});

test('direct connections resolve the TCP peer and preserve the authentication request body', async () => {
  const body = JSON.stringify({ email: 'trader@example.com', password: 'example-password' });
  const request = new Request('http://localhost/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '6.6.6.6', 'X-Client-IP': '1.2.3.4' },
    body,
  });
  const resolved = withResolvedClientIp({
    request,
    server: { requestIP: () => ({ address: '203.0.113.42' }) },
  }, clientIpResolver());
  expect(resolved.headers.get('x-client-ip')).toBe('203.0.113.42');
  expect(resolved.method).toBe('POST');
  expect(await resolved.text()).toBe(body);
});

test('a missing trusted proxy value removes a spoofed internal client IP', () => {
  const request = new Request('http://localhost/', { headers: { 'X-Client-IP': '1.2.3.4' } });
  const resolved = withResolvedClientIp({ request }, clientIpResolver('x-forwarded-for'));
  expect(resolved.headers.has('x-client-ip')).toBe(false);
});
