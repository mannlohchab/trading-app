// Better Auth adapter for the identity module. Framework glue only: every business decision is
// delegated to the domain/application layers.
import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { phoneNumber } from 'better-auth/plugins';
import type { AuthConfig } from '../../../config';
import { CLIENT_IP_HEADER } from '../../../http/client-ip';
import { authAccounts, authVerifications, users, userSessions } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { AccountRepository, Clock } from '../application/ports';
import type { PhoneVerificationService, SendCodeResult } from '../application/phone-verification.service';
import { ACCOUNT_STATUSES, canSignIn, verificationTimestamps } from '../domain/account';
import { isE164, OTP_POLICY, type OtpAttemptOutcome } from '../domain/phone-otp';

export const AUTH_BASE_PATH = '/api/v1/auth';
const PHONE_OTP_IDENTIFIER_PREFIX = 'phone-number-otp-';

const sendErrors: Record<Exclude<SendCodeResult, { ok: true }>['error'], [status: ConstructorParameters<typeof APIError>[0], message: string]> = {
  INVALID_PHONE_NUMBER: ['BAD_REQUEST', 'Enter the phone number in international format, e.g. +919876543210.'],
  ACCOUNT_DISABLED: ['FORBIDDEN', 'This account is disabled.'],
  PHONE_NUMBER_TAKEN: ['BAD_REQUEST', 'This phone number is already linked to another account.'],
  RESEND_COOLDOWN: ['TOO_MANY_REQUESTS', 'Please wait before requesting another code.'],
  HOURLY_LIMIT: ['TOO_MANY_REQUESTS', 'Too many codes requested. Try again later.'],
  SMS_DELIVERY_FAILED: ['SERVICE_UNAVAILABLE', 'We could not send the code. Try again shortly.'],
};
const verifyErrors: Record<Exclude<OtpAttemptOutcome, 'VERIFIED'>, [ConstructorParameters<typeof APIError>[0], string]> = {
  INVALID_CODE: ['BAD_REQUEST', 'That code is incorrect.'],
  EXPIRED: ['BAD_REQUEST', 'That code has expired. Request a new one.'],
  TOO_MANY_ATTEMPTS: ['FORBIDDEN', 'Too many incorrect attempts. Request a new code.'],
  NOT_FOUND: ['BAD_REQUEST', 'No active code for this number. Request a new one.'],
};

type Deps = { db: AppDatabase; config: AuthConfig; phoneVerification: PhoneVerificationService; accounts: AccountRepository; clock: Clock };

export function createAuth({ db, config, phoneVerification, accounts, clock }: Deps) {
  return betterAuth({
    appName: 'TradingGurukul',
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    // Apple's callback is a cross-site form POST from appleid.apple.com.
    trustedOrigins: [...config.trustedOrigins, ...(config.apple ? ['https://appleid.apple.com'] : [])],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: userSessions, account: authAccounts, verification: authVerifications },
    }),
    advanced: {
      database: { generateId: 'uuid' },
      // Only trust the IP the HTTP layer resolved (see src/http/client-ip.ts), never raw client headers.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    user: {
      additionalFields: {
        status: { type: [...ACCOUNT_STATUSES], required: false, input: false },
        phoneVerifiedAt: { type: 'date', required: false, input: false },
        emailVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    account: {
      fields: { accountId: 'providerAccountId', providerId: 'provider', password: 'passwordHash' },
      encryptOAuthTokens: true,
      // Google and Apple verify emails, so an existing email account can be linked on social sign-in.
      accountLinking: { enabled: true, trustedProviders: ['google', 'apple'] },
    },

    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    socialProviders: {
      ...(config.google && { google: { ...config.google, prompt: 'select_account' as const } }),
      ...(config.apple && { apple: { ...config.apple, ...(config.appleBundleId && { appBundleIdentifier: config.appleBundleId }) } }),
    },

    plugins: [
      phoneNumber({
        otpLength: OTP_POLICY.length,
        expiresIn: OTP_POLICY.ttlSeconds,
        phoneNumberValidator: isE164,
        async sendOTP({ phoneNumber, code }, ctx) {
          const session = ctx && (await getSessionFromCtx(ctx));
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Sign in before verifying a phone number.' });
          const result = await phoneVerification.sendCode({
            userId: session.user.id,
            phoneNumber,
            code,
            requestMetadata: { userAgent: ctx?.headers?.get('user-agent') ?? null },
          });
          if (!result.ok) {
            const [status, message] = sendErrors[result.error];
            throw new APIError(status, { message, code: result.error, ...('retryAfterSeconds' in result && { retryAfterSeconds: result.retryAfterSeconds }) });
          }
        },
        async verifyOTP({ phoneNumber, code }, ctx) {
          const session = ctx && (await getSessionFromCtx(ctx));
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Sign in before verifying a phone number.' });
          const outcome = await phoneVerification.verifyCode({ userId: session.user.id, phoneNumber, code });
          if (outcome !== 'VERIFIED') {
            const [status, message] = verifyErrors[outcome];
            throw new APIError(status, { message, code: outcome });
          }
          return true;
        },
        async callbackOnVerification({ user }) {
          await phoneVerification.activateIfEligible(user.id);
        },
      }),
      expo(),
    ],
    // Flow is social/email sign-in + phone verification; phone-number login and reset are not offered.
    // Profile edits go through the profiles module (PATCH /api/v1/me/profile), deletion through
    // POST /api/v1/me/deletion-request, so Better Auth's own versions are off.
    disabledPaths: [
      '/sign-in/phone-number',
      '/phone-number/request-password-reset',
      '/phone-number/reset-password',
      '/update-user',
      '/delete-user',
    ],

    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path !== '/phone-number/send-otp' && ctx.path !== '/phone-number/verify') return;
        const session = await getSessionFromCtx(ctx);
        if (!session) throw new APIError('UNAUTHORIZED', { message: 'Sign in before verifying a phone number.' });
        // Always attach the number to the signed-in user (never "sign in as whoever owns this number").
        if (ctx.path === '/phone-number/verify') return { context: { body: { ...ctx.body, updatePhoneNumber: true } } };
      }),
    },

    databaseHooks: {
      user: {
        create: { before: async user => ({ data: { ...user, ...verificationTimestamps(user, clock.now()) } }) },
        update: { before: async user => ({ data: { ...user, ...verificationTimestamps(user, clock.now()) } }) },
      },
      session: {
        create: {
          before: async session => {
            const account = await accounts.findAccount(session.userId);
            if (!account || !canSignIn(account.status)) {
              throw new APIError('FORBIDDEN', { message: 'This account is disabled.', code: 'ACCOUNT_DISABLED' });
            }
            // Better Auth uses "" for an unknown client IP; the column is INET.
            return { data: { ...session, ipAddress: session.ipAddress || null } };
          },
        },
      },
      verification: {
        create: {
          // The phone plugin always stores its plaintext code here. We verify against the HMAC in
          // phone_verifications instead, so replace it before it reaches the database.
          before: async verification =>
            verification.identifier.startsWith(PHONE_OTP_IDENTIFIER_PREFIX)
              ? { data: { ...verification, value: 'hashed-in-phone_verifications' } }
              : undefined,
        },
      },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/phone-number/send-otp': { window: 60, max: 3 },
        '/phone-number/verify': { window: 60, max: 10 },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
