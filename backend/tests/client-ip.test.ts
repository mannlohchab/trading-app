import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { clientIpResolver } from '../src/http/client-ip';

const resolveWith = async (header: string | undefined, headers: Record<string, string>) => {
  const app = new Hono().get('/', c => c.text(clientIpResolver(header)(c) ?? 'none'));
  return (await app.request('/', { headers })).text();
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
