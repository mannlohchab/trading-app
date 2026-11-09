import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { authAccounts, authVerifications, phoneVerifications, users, userSessions } from '../../src/db/schema';
import type { AuthVariables } from '../../src/modules/identity';
import { client, createTestApp } from '../helpers/test-app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let guarded: Hono<{ Variables: AuthVariables }>;
beforeAll(async () => {
  t = await createTestApp();
  // A stand-in application endpoint protected by the active-user guard.
  guarded = new Hono<{ Variables: AuthVariables }>();
  guarded.route('/', t.app);
  guarded.get('/api/v1/me', t.identity.requireActiveUser, c => c.json({ id: c.var.user.id, status: c.var.user.status }));
});
afterAll(() => t.close());

let n = 0;
const uniquePhone = () => `+9198765${String(43210 + ++n).padStart(5, '0')}`;
async function signUp(email = `trader${++n}@example.com`) {
  const c = client(guarded);
  const res = await c.post('/api/v1/auth/sign-up/email', { email, password: 'correct horse battery', name: 'Asha Trader' });
  expect(res.status).toBe(200);
  return { c, user: res.body.user, email };
}
async function sendCode(c: ReturnType<typeof client>, phoneNumber: string) {
  const res = await c.post('/api/v1/auth/phone-number/send-otp', { phoneNumber });
  return { ...res, code: t.sms.lastCode() };
}

describe('sign up and sign in with email', () => {
  test('sign-up creates a pending user, a credential account and a session', async () => {
    const { c, user, email } = await signUp();
    expect(user.status).toBe('PENDING_PHONE_VERIFICATION');
    expect(user.phoneNumberVerified).toBe(false);
    expect(c.cookie).toContain('better-auth.session_token=');

    const [account] = await t.db.select().from(authAccounts).where(eq(authAccounts.userId, user.id));
    expect(account?.provider).toBe('credential');
    expect(account?.passwordHash).not.toContain('correct horse');

    const session = await c.get('/api/v1/auth/get-session');
    expect(session.body.user.email).toBe(email);
  });

  test('sign-in accepts the right password and rejects a wrong one', async () => {
    const { email } = await signUp();
    expect((await client(guarded).post('/api/v1/auth/sign-in/email', { email, password: 'wrong password!' })).status).toBe(401);
    const ok = await client(guarded).post('/api/v1/auth/sign-in/email', { email, password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);
  });

  test('sign-out ends the session', async () => {
    const { c, user } = await signUp();
    expect((await c.post('/api/v1/auth/sign-out')).status).toBe(200);
    expect((await c.get('/api/v1/auth/get-session')).body).toBeNull();
    expect(await t.db.select().from(userSessions).where(eq(userSessions.userId, user.id))).toEqual([]);
  });

  test('suspended accounts cannot sign in', async () => {
    const { user, email } = await signUp();
    await t.db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, user.id));
    const res = await client(guarded).post('/api/v1/auth/sign-in/email', { email, password: 'correct horse battery' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('rate limiting', () => {
  test('repeated sign-in attempts from one IP are throttled', async () => {
    const attacker = client(guarded, '203.0.113.7');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await attacker.post('/api/v1/auth/sign-in/email', { email: 'victim@example.com', password: `guess-${i}-guess` })).status);
    }
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('client IP', () => {
  test('a client-sent x-client-ip header is ignored; sessions record the resolved IP', async () => {
    const res = await guarded.request('/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { Origin: 'http://localhost:4001', 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.20', 'x-client-ip': '1.2.3.4' },
      body: JSON.stringify({ email: 'ip-check@example.com', password: 'correct horse battery', name: 'IP Check' }),
    });
    expect(res.status).toBe(200);
    const { user } = await res.json() as { user: { id: string } };
    const [session] = await t.db.select().from(userSessions).where(eq(userSessions.userId, user.id));
    expect(session?.ipAddress).toBe('198.51.100.20');
  });
});

describe('social sign-in', () => {
  test('Google sign-in returns the provider authorization URL', async () => {
    const res = await client(guarded).post('/api/v1/auth/sign-in/social', { provider: 'google', callbackURL: '/' });
    expect(res.status).toBe(200);
    expect(res.body.url).toStartWith('https://accounts.google.com/');
  });
});

describe('phone verification', () => {
  test('requires a signed-in user', async () => {
    const before = t.sms.sent.length;
    const res = await client(guarded).post('/api/v1/auth/phone-number/send-otp', { phoneNumber: uniquePhone() });
    expect(res.status).toBe(401);
    expect(t.sms.sent.length).toBe(before);
  });

  test('rejects numbers that are not E.164', async () => {
    const { c } = await signUp();
    expect((await c.post('/api/v1/auth/phone-number/send-otp', { phoneNumber: '9876543210' })).status).toBe(400);
  });

  test('OTPs are texted but only stored as keyed hashes', async () => {
    const { c, user } = await signUp();
    const phoneNumber = uniquePhone();
    const sent = await sendCode(c, phoneNumber);
    expect(sent.status).toBe(200);
    expect(sent.code).toMatch(/^\d{6}$/);
    expect(t.sms.sent.at(-1)?.to).toBe(phoneNumber);

    const [row] = await t.db.select().from(phoneVerifications).where(eq(phoneVerifications.userId, user.id));
    expect(row?.purpose).toBe('REGISTRATION');
    expect(row?.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.otpHash).not.toContain(sent.code!);
    const leftovers = await t.db.select().from(authVerifications);
    expect(leftovers.some(v => v.value.includes(sent.code!))).toBe(false);
  });

  test('a correct code verifies the phone and activates the account', async () => {
    const { c, user } = await signUp();
    const phoneNumber = uniquePhone();
    const { code } = await sendCode(c, phoneNumber);

    const res = await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code });
    expect(res.status).toBe(200);

    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ status: 'ACTIVE', phoneNumber, phoneNumberVerified: true });
    expect(row?.phoneVerifiedAt).toBeInstanceOf(Date);
    expect((await c.get('/api/v1/auth/get-session')).body.user).toMatchObject({ status: 'ACTIVE', phoneNumber });
    // The code is single-use.
    expect((await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code })).status).toBe(400);
  });

  test('wrong codes are counted and the challenge locks after the attempt limit', async () => {
    const { c, user } = await signUp();
    const phoneNumber = uniquePhone();
    const { code } = await sendCode(c, phoneNumber);
    const wrong = code === '000000' ? '111111' : '000000';

    const first = await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code: wrong });
    expect(first.status).toBe(400);
    expect(first.body.code).toBe('INVALID_CODE');
    for (let i = 0; i < 4; i++) await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code: wrong });

    const locked = await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.status).toBe('PENDING_PHONE_VERIFICATION');
  });

  test('codes expire', async () => {
    const { c } = await signUp();
    const phoneNumber = uniquePhone();
    const { code } = await sendCode(c, phoneNumber);
    t.clock.advance(301);
    const res = await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EXPIRED');
  });

  test('resends are throttled', async () => {
    const { c } = await signUp();
    const phoneNumber = uniquePhone();
    expect((await sendCode(c, phoneNumber)).status).toBe(200);
    const again = await sendCode(c, phoneNumber);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('RESEND_COOLDOWN');
    t.clock.advance(61);
    expect((await sendCode(c, phoneNumber)).status).toBe(200);
  });

  test("a number already on another account can't be claimed", async () => {
    const phoneNumber = uniquePhone();
    const owner = await signUp();
    const { code } = await sendCode(owner.c, phoneNumber);
    expect((await owner.c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code })).status).toBe(200);

    const other = await signUp();
    const res = await other.c.post('/api/v1/auth/phone-number/send-otp', { phoneNumber });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PHONE_NUMBER_TAKEN');
  });

  test('SMS provider failures are reported, not swallowed', async () => {
    const { c } = await signUp();
    t.sms.fail = true;
    try {
      const res = await c.post('/api/v1/auth/phone-number/send-otp', { phoneNumber: uniquePhone() });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SMS_DELIVERY_FAILED');
    } finally {
      t.sms.fail = false;
    }
  });

  test('phone-number sign-in and reset endpoints are disabled', async () => {
    for (const path of ['sign-in/phone-number', 'phone-number/request-password-reset', 'phone-number/reset-password']) {
      const res = await client(guarded).post(`/api/v1/auth/${path}`, { phoneNumber: uniquePhone(), password: 'x', otp: '123456', newPassword: 'y' });
      expect(res.status).toBe(404);
    }
  });
});

describe('active-user guard for application endpoints', () => {
  test('no session → 401, pending → 403, active → 200', async () => {
    expect((await client(guarded).get('/api/v1/me')).status).toBe(401);

    const { c, user } = await signUp();
    const pending = await c.get('/api/v1/me');
    expect(pending.status).toBe(403);
    expect(pending.body.code).toBe('PHONE_VERIFICATION_REQUIRED');

    const phoneNumber = uniquePhone();
    const { code } = await sendCode(c, phoneNumber);
    await c.post('/api/v1/auth/phone-number/verify', { phoneNumber, code });
    const active = await c.get('/api/v1/me');
    expect(active.status).toBe(200);
    expect(active.body).toEqual({ id: user.id, status: 'ACTIVE' });
  });

  test('repairs an activation that was interrupted after phone verification', async () => {
    const { c, user } = await signUp();
    await t.db.update(users)
      .set({ phoneNumber: uniquePhone(), phoneNumberVerified: true, phoneVerifiedAt: new Date() })
      .where(eq(users.id, user.id));
    const res = await c.get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
  });
});
