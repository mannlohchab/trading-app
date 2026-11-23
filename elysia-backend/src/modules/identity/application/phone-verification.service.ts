// Use cases for the "verify phone → activate account" step of sign-up.
import { statusAfterPhoneVerified, type AccountStatus } from '../domain/account';
import {
  decideOtpAttempt,
  decideOtpSend,
  isE164,
  OTP_POLICY,
  otpMessage,
  otpPurposeFor,
  type OtpAttemptOutcome,
  type OtpPolicy,
} from '../domain/phone-otp';
import type { AccountRepository, Clock, OtpHasher, PhoneVerificationStore, SmsSender } from './ports';

export type SendCodeResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_PHONE_NUMBER' | 'ACCOUNT_DISABLED' | 'PHONE_NUMBER_TAKEN' | 'SMS_DELIVERY_FAILED' }
  | { ok: false; error: 'RESEND_COOLDOWN' | 'HOURLY_LIMIT'; retryAfterSeconds: number };

export type Deps = {
  accounts: AccountRepository;
  verifications: PhoneVerificationStore;
  sms: SmsSender;
  hasher: OtpHasher;
  clock: Clock;
  policy?: OtpPolicy;
};

export class PhoneVerificationService {
  private readonly policy: OtpPolicy;
  constructor(private readonly deps: Deps) {
    this.policy = deps.policy ?? OTP_POLICY;
  }

  /** Stores a hashed challenge for `code` and texts it to the user. */
  async sendCode(input: { userId: string; phoneNumber: string; code: string; requestMetadata?: Record<string, unknown> }): Promise<SendCodeResult> {
    const { accounts, verifications, sms, hasher, clock } = this.deps;
    const { userId, phoneNumber, code } = input;
    if (!isE164(phoneNumber)) return { ok: false, error: 'INVALID_PHONE_NUMBER' };

    const status = (await accounts.findAccount(userId))?.status;
    if (status !== 'PENDING_PHONE_VERIFICATION' && status !== 'ACTIVE') return { ok: false, error: 'ACCOUNT_DISABLED' };
    if (await accounts.isPhoneNumberTaken(phoneNumber, userId)) return { ok: false, error: 'PHONE_NUMBER_TAKEN' };

    const now = clock.now();
    const decision = decideOtpSend(await verifications.recentSendTimes(phoneNumber, userId, new Date(now.getTime() - 3_600_000)), now, this.policy);
    if (!decision.allowed) return { ok: false, error: decision.reason, retryAfterSeconds: decision.retryAfterSeconds };

    await verifications.createChallenge({
      userId,
      phoneNumber,
      otpHash: hasher.hash(phoneNumber, code),
      purpose: otpPurposeFor(status),
      expiresAt: new Date(now.getTime() + this.policy.ttlSeconds * 1000),
      maxAttempts: this.policy.maxAttempts,
      provider: sms.name,
      requestMetadata: input.requestMetadata ?? {},
      createdAt: now,
    });
    try {
      await sms.send(phoneNumber, otpMessage(code, this.policy));
    } catch {
      return { ok: false, error: 'SMS_DELIVERY_FAILED' };
    }
    return { ok: true };
  }

  /** Checks a code against the newest challenge, counting the attempt. */
  async verifyCode(input: { userId: string; phoneNumber: string; code: string }): Promise<OtpAttemptOutcome> {
    const { verifications, hasher, clock } = this.deps;
    const decision = await verifications.attempt(input.userId, input.phoneNumber, challenge =>
      decideOtpAttempt(challenge, !!challenge && hasher.matches(input.phoneNumber, input.code, challenge.otpHash), clock.now()),
    );
    return decision.outcome;
  }

  /** Activates a pending account whose phone is verified. Safe to call repeatedly. Returns the resulting status. */
  async activateIfEligible(userId: string): Promise<AccountStatus | null> {
    const account = await this.deps.accounts.findAccount(userId);
    if (!account) return null;
    if (!account.phoneNumberVerified) return account.status;
    const next = statusAfterPhoneVerified(account.status);
    if (next === account.status) return next;
    if (await this.deps.accounts.transitionStatus(userId, account.status, next)) return next;
    return (await this.deps.accounts.findAccount(userId))?.status ?? null; // changed concurrently
  }
}
