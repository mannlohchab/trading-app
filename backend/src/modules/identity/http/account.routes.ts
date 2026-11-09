import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { parseJson } from '../../../http/validation';
import type { AccountDeletionService } from '../application/account-deletion.service';
import type { AuthVariables } from './require-active-user';

const deletionRequest = z.strictObject({
  confirm: z.literal(true, 'Set "confirm": true to delete your account.'),
  reason: z.string().max(500).optional(),
});

const deletionErrors = {
  ACCOUNT_DISABLED: [403, 'This account is disabled.'],
  REAUTHENTICATION_REQUIRED: [403, 'Sign in again to delete your account.'],
  CONFLICT: [409, 'Your account changed while processing the request. Try again.'],
} as const;

/** POST /api/v1/me/deletion-request: deactivates the account now and schedules permanent deletion. */
export function accountRoutes(deletion: AccountDeletionService, requireSignedInUser: MiddlewareHandler<{ Variables: AuthVariables }>) {
  return new Hono<{ Variables: AuthVariables }>().post('/api/v1/me/deletion-request', requireSignedInUser, async c => {
    const body = await parseJson(c, deletionRequest);
    if ('response' in body) return body.response;
    const result = await deletion.requestDeletion({
      userId: c.var.user.id,
      sessionCreatedAt: new Date(c.var.session.createdAt),
      reason: body.data.reason,
    });
    if (!result.ok) {
      const [status, error] = deletionErrors[result.error];
      return c.json({ error, code: result.error }, status);
    }
    return c.json({ status: 'DELETION_REQUESTED', purgeAfter: result.purgeAfter.toISOString() }, 202);
  });
}
