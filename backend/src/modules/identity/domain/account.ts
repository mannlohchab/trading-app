// Account lifecycle rules. Pure functions: no framework, database or I/O.

export const ACCOUNT_STATUSES = ['PENDING_PHONE_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** A verified phone activates a pending account. Suspended/deleted accounts stay as they are. */
export function statusAfterPhoneVerified(current: AccountStatus): AccountStatus {
  return current === 'PENDING_PHONE_VERIFICATION' ? 'ACTIVE' : current;
}

/** Pending users may sign in (they must finish phone verification); disabled accounts may not. */
export function canSignIn(status: AccountStatus): boolean {
  return status === 'PENDING_PHONE_VERIFICATION' || status === 'ACTIVE';
}

/** Only ACTIVE users may use authenticated application endpoints. */
export function canUseApp(status: AccountStatus): boolean {
  return status === 'ACTIVE';
}

export type AppAccessDenial = 'PHONE_VERIFICATION_REQUIRED' | 'ACCOUNT_DISABLED';
export function appAccessDenial(status: AccountStatus): AppAccessDenial | null {
  if (canUseApp(status)) return null;
  return status === 'PENDING_PHONE_VERIFICATION' ? 'PHONE_VERIFICATION_REQUIRED' : 'ACCOUNT_DISABLED';
}

/**
 * Keeps the "verified at" timestamps in step with the verified flags in a user change set:
 * becoming verified records `now`, losing verification clears the timestamp.
 */
export function verificationTimestamps(
  change: { emailVerified?: unknown; phoneNumberVerified?: unknown },
  now: Date,
): { emailVerifiedAt?: Date | null; phoneVerifiedAt?: Date | null } {
  const out: { emailVerifiedAt?: Date | null; phoneVerifiedAt?: Date | null } = {};
  if (typeof change.emailVerified === 'boolean') out.emailVerifiedAt = change.emailVerified ? now : null;
  if (typeof change.phoneNumberVerified === 'boolean') out.phoneVerifiedAt = change.phoneNumberVerified ? now : null;
  return out;
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/** Days between a deletion request and the permanent purge of the user's data. */
export const DELETION_GRACE_DAYS = 30;
/** Deletion needs a recent sign-in, like other sensitive actions. */
export const DELETION_MAX_SESSION_AGE_HOURS = 24;

export type DeletionDecision =
  | { allowed: true; deactivateAt: Date; purgeAfter: Date }
  | { allowed: false; reason: 'ACCOUNT_DISABLED' | 'REAUTHENTICATION_REQUIRED' };

export function decideDeletionRequest(status: AccountStatus, sessionCreatedAt: Date, now: Date): DeletionDecision {
  if (!canSignIn(status)) return { allowed: false, reason: 'ACCOUNT_DISABLED' };
  if (now.getTime() - sessionCreatedAt.getTime() > DELETION_MAX_SESSION_AGE_HOURS * 3_600_000) {
    return { allowed: false, reason: 'REAUTHENTICATION_REQUIRED' };
  }
  return { allowed: true, deactivateAt: now, purgeAfter: new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000) };
}
