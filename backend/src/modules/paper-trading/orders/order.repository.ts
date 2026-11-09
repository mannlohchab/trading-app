import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { exchanges, paperOrders, tradingSymbols } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { OrderRow } from '../execution/paper-execution.engine';
import type { Db } from '../paper-trading.repository';

export const OPEN_STATUSES = ['PENDING', 'OPEN', 'PARTIALLY_FILLED'] as const;

export class OrderRepository {
  constructor(private readonly db: AppDatabase) {}

  async byIdempotencyKey(db: Db, accountId: string, key: string) {
    const [r] = await db.select().from(paperOrders).where(and(eq(paperOrders.paperAccountId, accountId), eq(paperOrders.idempotencyKey, key)));
    return r ?? null;
  }
  async countOpen(db: Db, accountId: string) {
    const [r] = await db.select({ n: count() }).from(paperOrders).where(and(eq(paperOrders.paperAccountId, accountId), inArray(paperOrders.status, [...OPEN_STATUSES])));
    return r?.n ?? 0;
  }
  async countSince(db: Db, accountId: string, since: Date) {
    const [r] = await db.select({ n: count() }).from(paperOrders).where(and(eq(paperOrders.paperAccountId, accountId), gte(paperOrders.createdAt, since)));
    return r?.n ?? 0;
  }
  async get(id: string, db: Db = this.db): Promise<(OrderRow & { symbol: string }) | null> {
    const [r] = await db.select({ o: paperOrders, symbol: tradingSymbols.symbol }).from(paperOrders)
      .innerJoin(tradingSymbols, eq(tradingSymbols.id, paperOrders.symbolId)).where(eq(paperOrders.id, id));
    return r ? { ...r.o, symbol: r.symbol } : null;
  }
  async getForUser(userId: string, id: string) {
    const r = await this.get(id);
    return r && r.userId === userId ? r : null;
  }
  async list(userId: string, f: { accountId?: string; status?: OrderRow['status']; symbol?: string; limit: number; offset: number }) {
    const where = and(eq(paperOrders.userId, userId), f.accountId ? eq(paperOrders.paperAccountId, f.accountId) : undefined, f.status ? eq(paperOrders.status, f.status) : undefined, f.symbol ? eq(tradingSymbols.symbol, f.symbol.toUpperCase()) : undefined);
    const [rows, [total]] = await Promise.all([
      this.db.select({ o: paperOrders, symbol: tradingSymbols.symbol }).from(paperOrders).innerJoin(tradingSymbols, eq(tradingSymbols.id, paperOrders.symbolId))
        .where(where).orderBy(desc(paperOrders.createdAt), desc(paperOrders.id)).limit(f.limit).offset(f.offset),
      this.db.select({ n: count() }).from(paperOrders).innerJoin(tradingSymbols, eq(tradingSymbols.id, paperOrders.symbolId)).where(where),
    ]);
    return { total: total?.n ?? 0, rows: rows.map(r => ({ ...r.o, symbol: r.symbol })) };
  }
  /** Every open order with its symbol, for the execution engine's index (one query per refresh, not per tick). */
  openForEngine() {
    return this.db.select({ id: paperOrders.id, symbolId: paperOrders.symbolId, symbol: tradingSymbols.symbol, exchange: exchanges.code, type: paperOrders.orderType, status: paperOrders.status, createdAt: paperOrders.createdAt })
      .from(paperOrders).innerJoin(tradingSymbols, eq(tradingSymbols.id, paperOrders.symbolId)).innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(inArray(paperOrders.status, [...OPEN_STATUSES]));
  }
  async gauges() {
    const [r] = await this.db.select({ pending: sql<number>`count(*) filter (where ${paperOrders.status} in ('PENDING','OPEN','PARTIALLY_FILLED'))::int` }).from(paperOrders);
    return { openOrders: r?.pending ?? 0 };
  }
}
