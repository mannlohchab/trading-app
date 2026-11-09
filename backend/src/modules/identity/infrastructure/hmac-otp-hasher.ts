import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OtpHasher } from '../application/ports';

/** HMAC-SHA256 keyed with a server secret: a leaked table can't be brute-forced without the key. */
export class HmacOtpHasher implements OtpHasher {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error('OTP hashing secret must be at least 32 characters');
  }
  hash(phoneNumber: string, code: string) {
    return createHmac('sha256', this.secret).update(`phone-otp:${phoneNumber}:${code}`).digest('hex');
  }
  matches(phoneNumber: string, code: string, hash: string) {
    const expected = Buffer.from(this.hash(phoneNumber, code), 'hex');
    const actual = Buffer.from(hash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
