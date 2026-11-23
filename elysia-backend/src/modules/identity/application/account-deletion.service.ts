import { decideDeletionRequest } from '../domain/account';
import type { AccountDeletionStore, AccountRepository, Clock } from './ports';

export type DeletionResult =
  | { ok: true; purgeAfter: Date }
  | { ok: false; error: 'ACCOUNT_DISABLED' | 'REAUTHENTICATION_REQUIRED' | 'CONFLICT' };

export class AccountDeletionService {
  constructor(private readonly deps: { accounts: AccountRepository; deletions: AccountDeletionStore; clock: Clock }) {}

  async requestDeletion(input: { userId: string; sessionCreatedAt: Date; reason?: string }): Promise<DeletionResult> {
    const account = await this.deps.accounts.findAccount(input.userId);
    if (!account) return { ok: false, error: 'ACCOUNT_DISABLED' };
    const decision = decideDeletionRequest(account.status, input.sessionCreatedAt, this.deps.clock.now());
    if (!decision.allowed) return { ok: false, error: decision.reason };

    const done = await this.deps.deletions.requestDeletion({
      userId: input.userId,
      expectedStatus: account.status,
      deactivateAt: decision.deactivateAt,
      purgeAfter: decision.purgeAfter,
      reason: input.reason?.trim() || null,
    });
    return done ? { ok: true, purgeAfter: decision.purgeAfter } : { ok: false, error: 'CONFLICT' };
  }
}
