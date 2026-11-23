import { expect } from 'bun:test';
import { client, type createTestApp } from './test-app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let n = 0;

export const uniquePhone = () => `+9177${String(10000000 + ++n).slice(-8)}`;

/** Signs up with email; the user is PENDING_PHONE_VERIFICATION. */
export async function pendingUser(t: TestApp, name = 'Asha Trader') {
  const c = client(t.app);
  const email = `user${++n}-${Date.now()}@example.com`;
  const res = await c.post('/api/v1/auth/sign-up/email', { email, password: 'correct horse battery', name });
  expect(res.status).toBe(200);
  return { c, user: res.body.user as { id: string; name: string }, email };
}

/** Signs up and completes phone verification; the user is ACTIVE. */
export async function activeUser(t: TestApp, name?: string) {
  const u = await pendingUser(t, name);
  const phoneNumber = uniquePhone();
  expect((await u.c.post('/api/v1/auth/phone-number/send-otp', { phoneNumber })).status).toBe(200);
  expect((await u.c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code: t.sms.lastCode() })).status).toBe(200);
  return { ...u, phoneNumber };
}
