// Identity module: sign-in (email, Google, Apple), phone verification and account activation.
// This file is the module's public surface and its composition root.
import type { AuthConfig } from '../../config';
import type { AppDatabase } from '../../db/types';
import type { ClientIpResolver } from '../../http/client-ip';
import type { Clock, SmsSender } from './application/ports';
import { AccountDeletionService } from './application/account-deletion.service';
import { PhoneVerificationService } from './application/phone-verification.service';
import { createAuth } from './infrastructure/better-auth';
import { DrizzleAccountDeletionStore } from './infrastructure/drizzle-account-deletion.store';
import { DrizzleAccountRepository } from './infrastructure/drizzle-account.repository';
import { DrizzlePhoneVerificationStore } from './infrastructure/drizzle-phone-verification.store';
import { HmacOtpHasher } from './infrastructure/hmac-otp-hasher';
import { systemClock } from './infrastructure/system-clock';
import { Hono } from 'hono';
import { accountRoutes } from './http/account.routes';
import { authRoutes } from './http/auth.routes';
import { requireActiveUser, requireSignedInUser } from './http/require-active-user';
import { createHmac } from 'node:crypto';

export type { AuthVariables } from './http/require-active-user';
export type { SmsSender } from './application/ports';
export { ConsoleSmsSender } from './infrastructure/console-sms-sender';
export { ACCOUNT_PURGE_JOB } from './infrastructure/drizzle-account-deletion.store';

export function createIdentityModule(deps: { db: AppDatabase; config: AuthConfig; sms: SmsSender; clientIp: ClientIpResolver; clock?: Clock }) {
  const clock = deps.clock ?? systemClock;
  const accounts = new DrizzleAccountRepository(deps.db);
  // A key derived from the auth secret, used only for OTP hashing.
  const otpKey = createHmac('sha256', deps.config.secret).update('phone-otp-hmac-key').digest('hex');
  const phoneVerification = new PhoneVerificationService({
    accounts,
    verifications: new DrizzlePhoneVerificationStore(deps.db),
    sms: deps.sms,
    hasher: new HmacOtpHasher(otpKey),
    clock,
  });
  const auth = createAuth({ db: deps.db, config: deps.config, phoneVerification, accounts, clock });
  const deletion = new AccountDeletionService({ accounts, deletions: new DrizzleAccountDeletionStore(deps.db), clock });
  const signedIn = requireSignedInUser(auth);

  return {
    auth,
    routes: new Hono().route('/', authRoutes(auth, deps.clientIp)).route('/', accountRoutes(deletion, signedIn)),
    requireActiveUser: requireActiveUser(auth, phoneVerification),
    requireSignedInUser: signedIn,
  };
}

export type IdentityModule = ReturnType<typeof createIdentityModule>;
