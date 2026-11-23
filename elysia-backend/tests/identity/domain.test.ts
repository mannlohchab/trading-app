import { describe, expect, test } from 'bun:test';
import { appAccessDenial, canSignIn, statusAfterPhoneVerified, verificationTimestamps } from '../../src/modules/identity/domain/account';
import { decideOtpAttempt, decideOtpSend, isE164, OTP_POLICY } from '../../src/modules/identity/domain/phone-otp';

const now = new Date('2026-11-09T10:00:00Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe('account rules', () => {
  test('phone verification activates only pending accounts', () => {
    expect(statusAfterPhoneVerified('PENDING_PHONE_VERIFICATION')).toBe('ACTIVE');
    expect(statusAfterPhoneVerified('SUSPENDED')).toBe('SUSPENDED');
    expect(statusAfterPhoneVerified('DELETED')).toBe('DELETED');
  });
  test('only pending and active users can sign in; only active users can use the app', () => {
    expect(canSignIn('PENDING_PHONE_VERIFICATION')).toBe(true);
    expect(canSignIn('SUSPENDED')).toBe(false);
    expect(appAccessDenial('ACTIVE')).toBeNull();
    expect(appAccessDenial('PENDING_PHONE_VERIFICATION')).toBe('PHONE_VERIFICATION_REQUIRED');
    expect(appAccessDenial('DELETED')).toBe('ACCOUNT_DISABLED');
  });
  test('verified-at timestamps follow the verified flags', () => {
    expect(verificationTimestamps({ emailVerified: true }, now)).toEqual({ emailVerifiedAt: now });
    expect(verificationTimestamps({ phoneNumberVerified: false }, now)).toEqual({ phoneVerifiedAt: null });
    expect(verificationTimestamps({ name: 'x' } as object, now)).toEqual({});
  });
});

describe('OTP rules', () => {
  test('phone numbers must be E.164', () => {
    expect(isE164('+919876543210')).toBe(true);
    expect(isE164('9876543210')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
  });
  test('sending enforces a resend cooldown and an hourly cap', () => {
    expect(decideOtpSend([], now)).toEqual({ allowed: true });
    expect(decideOtpSend([ago(10)], now)).toEqual({ allowed: false, reason: 'RESEND_COOLDOWN', retryAfterSeconds: 50 });
    const five = [ago(3000), ago(2400), ago(1800), ago(1200), ago(600)];
    expect(decideOtpSend(five, now)).toEqual({ allowed: false, reason: 'HOURLY_LIMIT', retryAfterSeconds: 600 });
    expect(decideOtpSend([ago(4000), ago(3700)], now)).toEqual({ allowed: true }); // older than an hour
  });
  test('attempts: wrong codes count, expiry and the attempt cap win over a correct code', () => {
    const open = { attempts: 0, maxAttempts: OTP_POLICY.maxAttempts, expiresAt: new Date(now.getTime() + 60_000), consumedAt: null };
    expect(decideOtpAttempt(null, true, now).outcome).toBe('NOT_FOUND');
    expect(decideOtpAttempt(open, false, now)).toEqual({ outcome: 'INVALID_CODE', change: { attempts: 1 } });
    expect(decideOtpAttempt({ ...open, attempts: 5 }, true, now).outcome).toBe('TOO_MANY_ATTEMPTS');
    expect(decideOtpAttempt({ ...open, expiresAt: now }, true, now).outcome).toBe('EXPIRED');
    expect(decideOtpAttempt({ ...open, consumedAt: ago(1) }, true, now).outcome).toBe('NOT_FOUND');
    expect(decideOtpAttempt(open, true, now)).toEqual({ outcome: 'VERIFIED', change: { attempts: 1, verifiedAt: now, consumedAt: now } });
  });
});
