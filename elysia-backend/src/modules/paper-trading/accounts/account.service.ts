import { eq } from 'drizzle-orm';
import { paperAccounts } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Logger } from '../../../logger';
import { dec } from '../../backtesting';
import { ACCOUNT_LIMITS, PAPER_CURRENCY } from '../paper-trading.constants';
import { PaperError } from '../paper-trading.errors';
import { LedgerWriter, ledgerPage, lockAccount, reconcileAccount, type AccountRow } from './ledger';
import type { AccountRepository } from './account.repository';

export const accountView = (a: AccountRow) => ({
  id: a.id,
  name: a.name,
  currency: a.currency,
  status: a.status === 'ARCHIVED' ? 'CLOSED' : a.status,
  initialBalance: dec.from(a.initialBalance),
  cashBalance: dec.from(a.currentBalance),
  reservedBalance: dec.from(a.reservedBalance),
  availableBalance: dec.sub(dec.from(a.currentBalance), dec.from(a.reservedBalance)),
  realizedPnl: dec.from(a.realizedPnl),
  totalFees: dec.from(a.totalFees),
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  closedAt: a.closedAt,
});

export class AccountService {
  constructor(private readonly deps: { db: AppDatabase; accounts: AccountRepository; clock: { now(): Date }; log: Logger }) {}

  /** Creates an account and funds it through the ledger (the only way virtual money enters). */
  async create(userId: string, input: { name: string; initialBalance?: string }) {
    const amount = dec.from(input.initialBalance ?? ACCOUNT_LIMITS.defaultInitialBalance);
    if (dec.cmp(amount, ACCOUNT_LIMITS.minInitialBalance) < 0 || dec.cmp(amount, ACCOUNT_LIMITS.maxInitialBalance) > 0) {
      throw new PaperError('VALIDATION_ERROR', `Initial balance must be between ${ACCOUNT_LIMITS.minInitialBalance} and ${ACCOUNT_LIMITS.maxInitialBalance} ${PAPER_CURRENCY}.`, { fields: { initialBalance: 'Out of range.' } });
    }
    if ((await this.deps.accounts.countForUser(userId)) >= ACCOUNT_LIMITS.maxAccountsPerUser) {
      throw new PaperError('TOO_MANY_ACCOUNTS', `At most ${ACCOUNT_LIMITS.maxAccountsPerUser} open paper accounts.`);
    }
    const account = await this.deps.db.transaction(async tx => {
      const row = await this.deps.accounts.insert(tx, { userId, name: input.name, initialBalance: amount });
      const locked = (await lockAccount(tx, row.id))!;
      const ledger = new LedgerWriter(tx, locked, this.deps.clock.now());
      ledger.deposit('deposit:initial', amount, 'Initial virtual funding');
      await ledger.commit();
      return (await lockAccount(tx, row.id))!;
    });
    this.deps.log('info', 'Paper account created', { accountId: account.id, userId, initialBalance: amount });
    return accountView(account);
  }

  async list(userId: string, limit: number, offset: number) {
    const [rows, total] = await Promise.all([this.deps.accounts.list(userId, limit, offset), this.deps.accounts.totalForUser(userId)]);
    return { accounts: rows.map(accountView), total, limit, offset };
  }

  async get(userId: string, id: string) {
    const row = await this.deps.accounts.getForUser(userId, id);
    if (!row) throw new PaperError('NOT_FOUND', 'Paper account not found.');
    const reconciliation = await reconcileAccount(this.deps.db, id);
    return { ...accountView(row), ledgerReconciled: reconciliation.ok };
  }

  /** Rename, pause/resume, or close (final; only when nothing is open or running). */
  async update(userId: string, id: string, changes: { name?: string; status?: 'ACTIVE' | 'PAUSED' | 'CLOSED' }) {
    const row = await this.deps.db.transaction(async tx => {
      const account = await lockAccount(tx, id, userId);
      if (!account) throw new PaperError('NOT_FOUND', 'Paper account not found.');
      if (account.status === 'CLOSED' || account.status === 'ARCHIVED') throw new PaperError('ACCOUNT_NOT_ACTIVE', 'This account is closed.');
      if (changes.status === 'CLOSED') {
        const activity = await this.deps.accounts.activity(tx, id);
        if (activity.openOrders || activity.openPositions || activity.liveStrategies) {
          throw new PaperError('ACCOUNT_NOT_EMPTY', 'Close positions, cancel orders and stop strategies before closing the account.', activity);
        }
      }
      const [updated] = await tx.update(paperAccounts).set({
        ...(changes.name && { name: changes.name }),
        ...(changes.status && { status: changes.status }),
        ...(changes.status === 'CLOSED' && { closedAt: this.deps.clock.now() }),
      }).where(eq(paperAccounts.id, id)).returning();
      return updated!;
    });
    if (changes.status) this.deps.log('info', 'Paper account status changed', { accountId: id, status: changes.status });
    return accountView(row);
  }

  async transactions(userId: string, id: string, limit: number, offset: number) {
    if (!(await this.deps.accounts.getForUser(userId, id))) throw new PaperError('NOT_FOUND', 'Paper account not found.');
    const { total, rows } = await ledgerPage(this.deps.db, id, limit, offset);
    return {
      total, limit, offset,
      transactions: rows.map(t => ({
        id: t.id, sequence: t.sequence, type: t.transactionType, amount: dec.from(t.amount), balanceAfter: dec.from(t.balanceAfter),
        reservedDelta: dec.from(t.reservedDelta), reservedAfter: dec.from(t.reservedAfter), orderId: t.orderId, description: t.description, metadata: t.metadata, createdAt: t.createdAt,
      })),
    };
  }

  reconcile(id: string) {
    return reconcileAccount(this.deps.db, id);
  }
}
