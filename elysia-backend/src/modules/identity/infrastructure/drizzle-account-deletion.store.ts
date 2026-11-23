import { and, eq } from 'drizzle-orm';
import { backgroundJobs, users, userSessions } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { AccountDeletionStore } from '../application/ports';

/** Job type consumed by the (future) worker that permanently erases the user's data. */
export const ACCOUNT_PURGE_JOB = 'identity.account.purge';

export class DrizzleAccountDeletionStore implements AccountDeletionStore {
  constructor(private readonly db: AppDatabase) {}

  requestDeletion(input: Parameters<AccountDeletionStore['requestDeletion']>[0]) {
    return this.db.transaction(async tx => {
      const changed = await tx
        .update(users)
        .set({ status: 'DELETED', deletedAt: input.deactivateAt })
        .where(and(eq(users.id, input.userId), eq(users.status, input.expectedStatus)))
        .returning({ id: users.id });
      if (!changed.length) return false;

      await tx.delete(userSessions).where(eq(userSessions.userId, input.userId));
      await tx.insert(backgroundJobs).values({
        jobType: ACCOUNT_PURGE_JOB,
        payload: { userId: input.userId, reason: input.reason, requestedAt: input.deactivateAt.toISOString() },
        availableAt: input.purgeAfter,
      });
      return true;
    });
  }
}
