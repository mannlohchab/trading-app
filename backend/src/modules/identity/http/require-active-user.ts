import { createMiddleware } from 'hono/factory';
import type { PhoneVerificationService } from '../application/phone-verification.service';
import { appAccessDenial, canSignIn, type AccountStatus } from '../domain/account';
import type { Auth } from '../infrastructure/better-auth';

type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthVariables = { user: Session['user']; session: Session['session'] };

const denialMessages = {
  PHONE_VERIFICATION_REQUIRED: 'Verify your phone number to continue.',
  ACCOUNT_DISABLED: 'This account is disabled.',
} as const;

/**
 * Guards application endpoints: requires a session and an ACTIVE account.
 * Sets `c.var.user` and `c.var.session`.
 */
export function requireActiveUser(auth: Auth, phoneVerification: PhoneVerificationService) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) return c.json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' }, 401);

    let status = result.user.status as AccountStatus;
    // Self-heal: if activation after phone verification was interrupted, apply it now.
    if (status === 'PENDING_PHONE_VERIFICATION' && result.user.phoneNumberVerified) {
      status = (await phoneVerification.activateIfEligible(result.user.id)) ?? status;
    }
    const denial = appAccessDenial(status);
    if (denial) return c.json({ error: denialMessages[denial], code: denial }, 403);

    c.set('user', { ...result.user, status });
    c.set('session', result.session);
    await next();
  });
}

/**
 * Guards endpoints any signed-in user may call, even before phone verification
 * (e.g. account deletion). Disabled accounts are still rejected.
 */
export function requireSignedInUser(auth: Auth) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) return c.json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' }, 401);
    if (!canSignIn(result.user.status as AccountStatus)) return c.json({ error: denialMessages.ACCOUNT_DISABLED, code: 'ACCOUNT_DISABLED' }, 403);
    c.set('user', result.user);
    c.set('session', result.session);
    await next();
  });
}
