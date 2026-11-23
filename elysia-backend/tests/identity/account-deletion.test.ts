import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { backgroundJobs, users, userSessions } from '../../src/db/schema';
import { ACCOUNT_PURGE_JOB } from '../../src/modules/identity';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp(); });
afterAll(() => t.close());

const DAY = 86_400_000;

test('requires a session and explicit confirmation', async () => {
  expect((await client(t.app).post('/api/v1/me/deletion-request', { confirm: true })).status).toBe(401);
  const { c } = await activeUser(t);
  const res = await c.post('/api/v1/me/deletion-request', {});
  expect(res.status).toBe(400);
  expect(res.body.fields).toHaveProperty('confirm');
});

test('deactivates the account, signs out everywhere and schedules the purge', async () => {
  const { c, user, email } = await activeUser(t);
  const other = client(t.app);
  expect((await other.post('/api/v1/auth/sign-in/email', { email, password: 'correct horse battery' })).status).toBe(200);

  const res = await c.post('/api/v1/me/deletion-request', { confirm: true, reason: 'Taking a break' });
  expect(res.status).toBe(202);
  expect(res.body.status).toBe('DELETION_REQUESTED');
  const purgeAfter = new Date(res.body.purgeAfter).getTime();
  expect(Math.round((purgeAfter - t.clock.now().getTime()) / DAY)).toBe(30);

  const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
  expect(row?.status).toBe('DELETED');
  expect(row?.deletedAt).toBeInstanceOf(Date);
  expect(await t.db.select().from(userSessions).where(eq(userSessions.userId, user.id))).toEqual([]);
  expect((await other.get('/api/v1/auth/get-session')).body).toBeNull();

  const [job] = await t.db.select().from(backgroundJobs).where(eq(backgroundJobs.jobType, ACCOUNT_PURGE_JOB));
  expect(job?.payload).toMatchObject({ userId: user.id, reason: 'Taking a break' });
  expect(job?.availableAt.getTime()).toBe(purgeAfter);
  expect(job?.status).toBe('PENDING');

  const signIn = await client(t.app).post('/api/v1/auth/sign-in/email', { email, password: 'correct horse battery' });
  expect(signIn.status).toBe(403);
  expect(signIn.body.code).toBe('ACCOUNT_DISABLED');
});

test('users who have not verified their phone can also request deletion', async () => {
  const { c } = await pendingUser(t);
  expect((await c.post('/api/v1/me/deletion-request', { confirm: true })).status).toBe(202);
});

test('an old session must sign in again first', async () => {
  const { c, user } = await activeUser(t);
  t.clock.advance(25 * 3600);
  const res = await c.post('/api/v1/me/deletion-request', { confirm: true });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('REAUTHENTICATION_REQUIRED');
  const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
  expect(row?.status).toBe('ACTIVE');
});
