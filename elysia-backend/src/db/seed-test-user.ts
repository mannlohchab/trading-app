// Development only: creates an ACTIVE test user (phone already verified) so the app can sign in
// without the OTP step. `bun run db:seed-test-user` — safe to re-run.
import { eq, sql } from 'drizzle-orm';
import { config } from '../config';
import { clientIpResolver } from '../http/client-ip';
import { ConsoleSmsSender, createIdentityModule } from '../modules/identity';
import { closeDatabase, db } from './client';
import { users } from './schema';

const EMAIL = process.env.TEST_USER_EMAIL ?? 'test@gmail.com';
const PASSWORD = process.env.TEST_USER_PASSWORD ?? 'pass1234';
const PHONE = process.env.TEST_USER_PHONE ?? '+919999999999';

if (config.isProduction) throw new Error('Refusing to seed a test user in production.');

try {
  const identity = createIdentityModule({ db, config: config.auth, sms: new ConsoleSmsSender(), clientIp: clientIpResolver(undefined) });
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  if (!existing.length) {
    await identity.auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Test User' } });
    console.log(`Created ${EMAIL}`);
  } else {
    console.log(`${EMAIL} already exists; making sure it is active`);
  }
  await db.update(users).set({
    status: 'ACTIVE', phoneNumber: PHONE, phoneNumberVerified: true, phoneVerifiedAt: sql`now()`,
    emailVerified: true, emailVerifiedAt: sql`now()`,
  }).where(eq(users.email, EMAIL));
  console.log(`Test user ready: ${EMAIL} / ${PASSWORD} (ACTIVE, phone ${PHONE})`);
} finally {
  await closeDatabase();
}
