import { HttpError } from '../../../http/errors';
import type { PhoneVerificationService } from '../application/phone-verification.service';
import { appAccessDenial, canSignIn, type AccountStatus } from '../domain/account';
import type { Auth } from '../infrastructure/better-auth';

type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthVariables = { user: Session['user']; session: Session['session'] };
export type UserGuard = (request: Request) => Promise<AuthVariables>;

const denialMessages = {
  PHONE_VERIFICATION_REQUIRED: 'Verify your phone number to continue.',
  ACCOUNT_DISABLED: 'This account is disabled.',
} as const;

/**
 * Guards application endpoints: requires a session and an ACTIVE account.
 * Returns the user and session for Elysia's route-local resolve hook.
 */
export function requireActiveUser(auth: Auth, phoneVerification: PhoneVerificationService): UserGuard {
  return async request => {
    const result = await auth.api.getSession({ headers: request.headers });
    if (!result) throw new HttpError(401, { error: 'Sign in to continue.', code: 'UNAUTHENTICATED' });

    let status = result.user.status as AccountStatus;
    // Self-heal: if activation after phone verification was interrupted, apply it now.
    if (status === 'PENDING_PHONE_VERIFICATION' && result.user.phoneNumberVerified) {
      status = (await phoneVerification.activateIfEligible(result.user.id)) ?? status;
    }
    const denial = appAccessDenial(status);
    if (denial) throw new HttpError(403, { error: denialMessages[denial], code: denial });

    return { user: { ...result.user, status }, session: result.session };
  };
}

/**
 * Guards endpoints any signed-in user may call, even before phone verification
 * (e.g. account deletion). Disabled accounts are still rejected.
 */
export function requireSignedInUser(auth: Auth): UserGuard {
  return async request => {
    const result = await auth.api.getSession({ headers: request.headers });
    if (!result) throw new HttpError(401, { error: 'Sign in to continue.', code: 'UNAUTHENTICATED' });
    if (!canSignIn(result.user.status as AccountStatus)) throw new HttpError(403, { error: denialMessages.ACCOUNT_DISABLED, code: 'ACCOUNT_DISABLED' });
    return { user: result.user, session: result.session };
  };
}
