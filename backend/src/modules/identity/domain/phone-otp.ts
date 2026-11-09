// Phone OTP rules. Pure functions: no framework, database or I/O.
import type { AccountStatus } from './account';

export const OTP_POLICY = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxSendsPerHour: 5,
} as const;
export type OtpPolicy = typeof OTP_POLICY;

export type OtpPurpose = 'REGISTRATION' | 'LOGIN' | 'PHONE_CHANGE' | 'ACCOUNT_RECOVERY';

const E164 = /^\+[1-9][0-9]{7,14}$/;
export const isE164 = (phoneNumber: string) => E164.test(phoneNumber);

/** First verification activates the account; later ones change the number. */
export const otpPurposeFor = (status: AccountStatus): OtpPurpose =>
  status === 'PENDING_PHONE_VERIFICATION' ? 'REGISTRATION' : 'PHONE_CHANGE';

export type SendDecision =
  | { allowed: true }
  | { allowed: false; reason: 'RESEND_COOLDOWN' | 'HOURLY_LIMIT'; retryAfterSeconds: number };

/** `recentSends` are the creation times of codes sent in the last hour (any order). */
export function decideOtpSend(recentSends: Date[], now: Date, policy: OtpPolicy = OTP_POLICY): SendDecision {
  const times = recentSends.map(d => d.getTime()).filter(t => now.getTime() - t < 3_600_000).sort((a, b) => b - a);
  const newest = times[0];
  if (newest !== undefined) {
    const wait = policy.resendCooldownSeconds - Math.floor((now.getTime() - newest) / 1000);
    if (wait > 0) return { allowed: false, reason: 'RESEND_COOLDOWN', retryAfterSeconds: wait };
  }
  if (times.length >= policy.maxSendsPerHour) {
    const oldest = times[times.length - 1]!;
    return { allowed: false, reason: 'HOURLY_LIMIT', retryAfterSeconds: Math.ceil((oldest + 3_600_000 - now.getTime()) / 1000) };
  }
  return { allowed: true };
}

export type OtpChallenge = {
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type OtpAttemptOutcome = 'VERIFIED' | 'INVALID_CODE' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'NOT_FOUND';

export type OtpAttemptDecision = {
  outcome: OtpAttemptOutcome;
  /** Changes to persist on the challenge, if any. */
  change?: { attempts?: number; verifiedAt?: Date; consumedAt?: Date };
};

/** Decides one verification attempt against the newest open challenge. */
export function decideOtpAttempt(challenge: OtpChallenge | null, codeMatches: boolean, now: Date): OtpAttemptDecision {
  if (!challenge || challenge.consumedAt) return { outcome: 'NOT_FOUND' };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { outcome: 'EXPIRED' };
  if (challenge.attempts >= challenge.maxAttempts) return { outcome: 'TOO_MANY_ATTEMPTS' };
  if (!codeMatches) return { outcome: 'INVALID_CODE', change: { attempts: challenge.attempts + 1 } };
  return { outcome: 'VERIFIED', change: { attempts: challenge.attempts + 1, verifiedAt: now, consumedAt: now } };
}

export const otpMessage = (code: string, policy: OtpPolicy = OTP_POLICY) =>
  `${code} is your TradingGurukul verification code. It expires in ${Math.round(policy.ttlSeconds / 60)} minutes. Never share it.`;
