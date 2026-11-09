import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { paperAccounts, paperOrders, paperPositions, paperStrategyInstances } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Db, Tx } from '../paper-trading.repository';

export class AccountRepository {
  constructor(private readonly db: AppDatabase) {}

  insert(tx: Tx, values: { userId: string; name: string; initialBalance: string }) {
    return tx.insert(paperAccounts).values({ ...values, currentBalance: '0', currency: 'USDT' }).returning().then(r => r[0]!);
  }
  async countForUser(userId: string, db: Db = this.db) {
    const [r] = await db.select({ n: count() }).from(paperAccounts).where(and(eq(paperAccounts.userId, userId), inArray(paperAccounts.status, ['ACTIVE', 'PAUSED'])));
    return r?.n ?? 0;
  }
  async getForUser(userId: string, id: string) {
    const [r] = await this.db.select().from(paperAccounts).where(and(eq(paperAccounts.id, id), eq(paperAccounts.userId, userId)));
    return r ?? null;
  }
  list(userId: string, limit: number, offset: number) {
    return this.db.select().from(paperAccounts).where(eq(paperAccounts.userId, userId)).orderBy(desc(paperAccounts.createdAt)).limit(limit).offset(offset);
  }
  async totalForUser(userId: string) {
    const [r] = await this.db.select({ n: count() }).from(paperAccounts).where(eq(paperAccounts.userId, userId));
    return r?.n ?? 0;
  }
  /** Open orders, open positions and live strategies (an account with any cannot be closed). */
  async activity(tx: Db, accountId: string) {
    const [[o], [p], [s]] = await Promise.all([
      tx.select({ n: count() }).from(paperOrders).where(and(eq(paperOrders.paperAccountId, accountId), inArray(paperOrders.status, ['PENDING', 'OPEN', 'PARTIALLY_FILLED']))),
      tx.select({ n: count() }).from(paperPositions).where(and(eq(paperPositions.paperAccountId, accountId), eq(paperPositions.status, 'OPEN'))),
      tx.select({ n: count() }).from(paperStrategyInstances).where(and(eq(paperStrategyInstances.paperAccountId, accountId), inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING', 'PAUSED']))),
    ]);
    return { openOrders: o?.n ?? 0, openPositions: p?.n ?? 0, liveStrategies: s?.n ?? 0 };
  }
}
