import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { authAccounts, exchanges, paperAccounts, users } from '../src/db/schema';
import { createTestDb } from './helpers/test-db';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

// Drizzle wraps driver errors; the Postgres constraint name lives on the cause.
async function violation(promise: Promise<unknown>) {
  try { await promise; } catch (error: any) { return error.cause?.constraint ?? error.constraint ?? String(error); }
  throw new Error('expected a constraint violation');
}

describe('migrations', () => {
  test('seed the Binance exchange', async () => {
    const rows = await t.db.select().from(exchanges);
    expect(rows.map(r => [r.code, r.exchangeType])).toEqual([['BINANCE', 'CRYPTO']]);
  });
});

describe('users', () => {
  test('new users start pending phone verification', async () => {
    const [user] = await t.db.insert(users).values({ phoneNumber: '+919876543210' }).returning();
    expect(user.status).toBe('PENDING_PHONE_VERIFICATION');
  });

  test('a user cannot become ACTIVE without a verified phone', async () => {
    expect(await violation(t.db.insert(users).values({ phoneNumber: '+14155550100', status: 'ACTIVE' })))
      .toBe('users_active_requires_verified_phone_chk');
  });

  test('verified flags and verified-at timestamps cannot disagree', async () => {
    expect(await violation(t.db.insert(users).values({ phoneNumber: '+14155550101', phoneNumberVerified: true })))
      .toBe('users_phone_verified_sync_chk');
    expect(await violation(t.db.insert(users).values({ email: 'sync@example.com', emailVerifiedAt: new Date() })))
      .toBe('users_email_verified_sync_chk');
  });

  test('phone numbers must be E.164', async () => {
    expect(await violation(t.db.insert(users).values({ phoneNumber: '9876543210' }))).toBe('users_phone_number_format_chk');
  });

  test('emails are unique regardless of case', async () => {
    await t.db.insert(users).values({ email: 'Trader@Example.com' });
    expect(await violation(t.db.insert(users).values({ email: 'trader@example.com' }))).toBe('users_email_lower_uq');
  });

  test('updated_at is refreshed by the trigger on update', async () => {
    const [user] = await t.db.insert(users).values({ username: 'trigger_check', updatedAt: new Date('2020-01-01') }).returning();
    const [updated] = await t.db.update(users).set({ email: 'trigger@example.com' }).where(eq(users.id, user.id)).returning();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(new Date('2020-01-01').getTime());
  });
});

describe('auth accounts', () => {
  test('credential accounts require a password hash and OAuth accounts forbid one', async () => {
    const [user] = await t.db.insert(users).values({}).returning();
    expect(await violation(t.db.insert(authAccounts).values({ userId: user.id, provider: 'credential', providerAccountId: user.id })))
      .toBe('auth_accounts_email_password_chk');
    expect(await violation(t.db.insert(authAccounts).values({ userId: user.id, provider: 'google', providerAccountId: 'g-1', passwordHash: 'x' })))
      .toBe('auth_accounts_email_password_chk');
  });
});

describe('paper accounts', () => {
  test('balances keep full NUMERIC precision as strings', async () => {
    const [user] = await t.db.insert(users).values({}).returning();
    const [account] = await t.db.insert(paperAccounts)
      .values({ userId: user.id, name: 'Main', initialBalance: '100000', currentBalance: '0.000000000001' }).returning();
    expect(account.currentBalance).toBe('0.000000000001');
    expect(account.currency).toBe('USDT');
    const [{ total }] = await t.db.execute<{ total: string }>(sql`select (current_balance + 0.1)::text total from paper_accounts where id = ${account.id}`).then(r => r.rows);
    expect(total).toBe('0.100000000001');
  });

  test('deleting a user cascades to their paper accounts', async () => {
    const [user] = await t.db.insert(users).values({}).returning();
    await t.db.insert(paperAccounts).values({ userId: user.id, name: 'Temp', initialBalance: '1', currentBalance: '1' });
    await t.db.delete(users).where(eq(users.id, user.id));
    expect(await t.db.select().from(paperAccounts).where(eq(paperAccounts.userId, user.id))).toEqual([]);
  });
});
