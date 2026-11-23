import { and, count, desc, eq } from 'drizzle-orm';
import { exchanges, paperPositions, tradingSymbols } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import { paperAccounts } from '../../../db/schema';
import type { Db } from '../paper-trading.repository';

export async function countOpenPositions(db: Db, accountId: string) {
  const [r] = await db.select({ n: count() }).from(paperPositions).where(and(eq(paperPositions.paperAccountId, accountId), eq(paperPositions.status, 'OPEN')));
  return r?.n ?? 0;
}

export class PositionRepository {
  constructor(private readonly db: AppDatabase) {}

  private base() {
    return this.db.select({ p: paperPositions, symbol: tradingSymbols.symbol, userId: paperAccounts.userId }).from(paperPositions)
      .innerJoin(paperAccounts, eq(paperAccounts.id, paperPositions.paperAccountId))
      .innerJoin(tradingSymbols, eq(tradingSymbols.id, paperPositions.symbolId));
  }
  async getForUser(userId: string, id: string) {
    const [r] = await this.base().where(and(eq(paperPositions.id, id), eq(paperAccounts.userId, userId)));
    return r ? { ...r.p, symbol: r.symbol } : null;
  }
  async list(userId: string, f: { accountId?: string; status?: 'OPEN' | 'CLOSED'; limit: number; offset: number }) {
    const where = and(eq(paperAccounts.userId, userId), f.accountId ? eq(paperPositions.paperAccountId, f.accountId) : undefined, f.status ? eq(paperPositions.status, f.status) : undefined);
    const [rows, [total]] = await Promise.all([
      this.base().where(where).orderBy(desc(paperPositions.openedAt), desc(paperPositions.id)).limit(f.limit).offset(f.offset),
      this.db.select({ n: count() }).from(paperPositions).innerJoin(paperAccounts, eq(paperAccounts.id, paperPositions.paperAccountId)).where(where),
    ]);
    return { total: total?.n ?? 0, rows: rows.map(r => ({ ...r.p, symbol: r.symbol })) };
  }
  async openForAccount(accountId: string) {
    const rows = await this.base().where(and(eq(paperPositions.paperAccountId, accountId), eq(paperPositions.status, 'OPEN')));
    return rows.map(r => ({ ...r.p, symbol: r.symbol }));
  }
  /** All open positions with symbols, for the engine (marks and short liquidation). */
  openForEngine() {
    return this.db.select({ p: paperPositions, symbol: tradingSymbols.symbol, exchange: exchanges.code, userId: paperAccounts.userId }).from(paperPositions)
      .innerJoin(paperAccounts, eq(paperAccounts.id, paperPositions.paperAccountId))
      .innerJoin(tradingSymbols, eq(tradingSymbols.id, paperPositions.symbolId)).innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(eq(paperPositions.status, 'OPEN'));
  }
}
