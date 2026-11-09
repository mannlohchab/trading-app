// Ports: what the identity use cases need from the outside world. Implemented in ../infrastructure.
import type { AccountStatus } from '../domain/account';
import type { OtpChallenge, OtpAttemptDecision, OtpPurpose } from '../domain/phone-otp';

export interface Clock {
  now(): Date;
}

export interface SmsSender {
  /** Provider name recorded on each verification (e.g. "console", "twilio"). */
  readonly name: string;
  send(to: string, message: string): Promise<void>;
}

/** Hashes OTPs so plaintext codes are never stored. Must be keyed (HMAC) so short codes can't be brute-forced from a leak. */
export interface OtpHasher {
  hash(phoneNumber: string, code: string): string;
  matches(phoneNumber: string, code: string, hash: string): boolean;
}

export interface AccountRepository {
  findAccount(userId: string): Promise<{ status: AccountStatus; phoneNumberVerified: boolean } | null>;
  /** True when another user already owns this phone number. */
  isPhoneNumberTaken(phoneNumber: string, exceptUserId: string): Promise<boolean>;
  /** Compare-and-set: changes the status only if it is still `from`. Returns whether it changed. */
  transitionStatus(userId: string, from: AccountStatus, to: AccountStatus): Promise<boolean>;
}

export type StoredOtpChallenge = OtpChallenge & { otpHash: string };

export interface PhoneVerificationStore {
  /** Creation times of codes sent to this phone or by this user since `since`. */
  recentSendTimes(phoneNumber: string, userId: string, since: Date): Promise<Date[]>;
  /** Stores a new challenge and closes any earlier open ones for the same user and phone. */
  createChallenge(input: {
    userId: string;
    phoneNumber: string;
    otpHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
    maxAttempts: number;
    provider: string;
    requestMetadata: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void>;
  /**
   * Loads the newest open challenge for this user and phone under a row lock, applies `decide`,
   * and persists the decision's change atomically.
   */
  attempt(userId: string, phoneNumber: string, decide: (challenge: StoredOtpChallenge | null) => OtpAttemptDecision): Promise<OtpAttemptDecision>;
}

export interface AccountDeletionStore {
  /**
   * Atomically: marks the user DELETED (only if still `expectedStatus`), deletes all their sessions,
   * and queues the purge job. Returns false if the status changed in the meantime.
   */
  requestDeletion(input: {
    userId: string;
    expectedStatus: AccountStatus;
    deactivateAt: Date;
    purgeAfter: Date;
    reason: string | null;
  }): Promise<boolean>;
}
