// The ledger writer: the only code that changes account balances. Works on an account row that the
// caller locked FOR UPDATE inside a transaction, appends entries (numbered without gaps) and writes
// the new balances in the same transaction.
//
// Model (1×, simulated): cash changes only by the deposit, realized P/L and fees. The reserved
// balance holds open-order reservations and the collateral (cost basis) of open positions.
// Available = cash − reserved. Equity = cash + unrealized P/L.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { paperAccounts, paperOrders, paperPositions, paperTransactions } from '../../../db/schema';
import { dec, type Decimal } from '../../backtesting';
import { PaperError } from '../paper-trading.errors';
import type { Db, Tx } from '../paper-trading.repository';

export type AccountRow = typeof paperAccounts.$inferSelect;
type EntryType = (typeof paperTransactions.$inferInsert)['transactionType'];
type Entry = { key: string; type: EntryType; cash: Decimal; reserved: Decimal; orderId?: string | null; description: string; metadata?: Record<string, unknown> };

export class LedgerWriter {
  private cash: Decimal;
  private reserved: Decimal;
  private realized: Decimal;
  private fees: Decimal;
  private sequence: number;
  private readonly entries: (Entry & { cashAfter: Decimal; reservedAfter: Decimal; sequence: number })[] = [];

  constructor(private readonly tx: Tx, readonly account: AccountRow, private readonly now: Date) {
    this.cash = dec.from(account.currentBalance);
    this.reserved = dec.from(account.reservedBalance);
    this.realized = dec.from(account.realizedPnl);
    this.fees = dec.from(account.totalFees);
    this.sequence = account.ledgerSequence;
  }

  get available() { return dec.sub(this.cash, this.reserved); }
  get balances() { return { cash: this.cash, reserved: this.reserved, available: this.available, realizedPnl: this.realized, totalFees: this.fees }; }

  private post(e: Entry) {
    if (dec.isZero(e.cash) && dec.isZero(e.reserved) && e.type !== 'ORDER_FILL') return; // nothing moved
    this.cash = dec.add(this.cash, e.cash);
    this.reserved = dec.add(this.reserved, e.reserved);
    if (dec.isNegative(this.reserved)) throw new Error(`Ledger invariant: reserved balance would be negative (${e.key})`);
    this.entries.push({ ...e, cashAfter: this.cash, reservedAfter: this.reserved, sequence: ++this.sequence });
  }

  deposit(key: string, amount: Decimal, description: string) {
    this.post({ key, type: 'INITIAL_DEPOSIT', cash: amount, reserved: '0', description });
  }
  /** Reserves from available; fails if available would go negative. */
  reserve(key: string, amount: Decimal, orderId: string, description: string) {
    if (dec.cmp(amount, this.available) > 0) {
      throw new PaperError('INSUFFICIENT_BALANCE', `Insufficient available balance: ${dec.round(this.available, 8)} available, ${dec.round(amount, 8)} required.`, { available: this.available, required: amount });
    }
    this.post({ key, type: 'ORDER_RESERVE', cash: '0', reserved: amount, orderId, description });
  }
  release(key: string, amount: Decimal, orderId: string, description: string) {
    this.post({ key, type: 'ORDER_RELEASE', cash: '0', reserved: dec.sub('0', amount), orderId, description });
  }
  lockMargin(key: string, amount: Decimal, orderId: string, metadata: Record<string, unknown>) {
    this.post({ key, type: 'POSITION_MARGIN', cash: '0', reserved: amount, orderId, description: 'Position collateral', metadata });
  }
  releaseMargin(key: string, amount: Decimal, orderId: string, metadata: Record<string, unknown>) {
    this.post({ key, type: 'POSITION_MARGIN_RELEASE', cash: '0', reserved: dec.sub('0', amount), orderId, description: 'Position collateral released', metadata });
  }
  realize(key: string, pnl: Decimal, orderId: string, metadata: Record<string, unknown>) {
    this.realized = dec.add(this.realized, pnl);
    this.post({ key, type: 'REALIZED_PNL', cash: pnl, reserved: '0', orderId, description: dec.isNegative(pnl) ? 'Realized loss' : 'Realized profit', metadata });
  }
  fee(key: string, amount: Decimal, orderId: string, metadata: Record<string, unknown>) {
    this.fees = dec.add(this.fees, amount);
    this.post({ key, type: 'TRADING_FEE', cash: dec.sub('0', amount), reserved: '0', orderId, description: 'Trading fee', metadata });
  }
  /** The trade itself (no balance change on its own; the other entries carry the money). */
  trade(key: string, orderId: string, metadata: Record<string, unknown>) {
    this.post({ key, type: 'ORDER_FILL', cash: '0', reserved: '0', orderId, description: 'Simulated fill', metadata });
  }

  /** Appends the entries and writes the account's new balances. Call once, at the end of the transaction. */
  async commit() {
    if (!this.entries.length) return;
    await this.tx.insert(paperTransactions).values(this.entries.map(e => ({
      paperAccountId: this.account.id,
      orderId: e.orderId ?? null,
      transactionType: e.type,
      amount: e.cash,
      balanceAfter: e.cashAfter,
      reservedDelta: e.reserved,
      reservedAfter: e.reservedAfter,
      sequence: e.sequence,
      entryKey: e.key,
      description: e.description,
      metadata: e.metadata ?? {},
      createdAt: this.now,
    })));
    await this.tx.update(paperAccounts).set({
      currentBalance: this.cash, reservedBalance: this.reserved, realizedPnl: this.realized, totalFees: this.fees, ledgerSequence: this.sequence,
    }).where(eq(paperAccounts.id, this.account.id));
  }
}

export async function lockAccount(tx: Tx, accountId: string, userId?: string): Promise<AccountRow | null> {
  const [row] = await tx.select().from(paperAccounts)
    .where(and(eq(paperAccounts.id, accountId), userId ? eq(paperAccounts.userId, userId) : undefined)).for('update');
  return row ?? null;
}

export type Reconciliation = { ok: boolean; mismatches: string[]; ledger: { cash: Decimal; reserved: Decimal; realizedPnl: Decimal; fees: Decimal; entries: number } };

/**
 * Recomputes balances from the ledger and compares them with the account row, and the reserved
 * balance with open orders' reservations plus open positions' collateral.
 */
export async function reconcileAccount(db: Db, accountId: string): Promise<Reconciliation> {
  const [account] = await db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId));
  if (!account) throw new PaperError('NOT_FOUND', 'Paper account not found.');
  const [sums] = await db.select({
    cash: sql<string>`coalesce(sum(${paperTransactions.amount}), 0)::text`,
    reserved: sql<string>`coalesce(sum(${paperTransactions.reservedDelta}), 0)::text`,
    realized: sql<string>`coalesce(sum(${paperTransactions.amount}) filter (where ${paperTransactions.transactionType} = 'REALIZED_PNL'), 0)::text`,
    fees: sql<string>`coalesce(-sum(${paperTransactions.amount}) filter (where ${paperTransactions.transactionType} = 'TRADING_FEE'), 0)::text`,
    entries: sql<number>`count(*)::int`,
    maxSequence: sql<number>`coalesce(max(${paperTransactions.sequence}), 0)::int`,
  }).from(paperTransactions).where(eq(paperTransactions.paperAccountId, accountId));
  const [last] = await db.select({ balanceAfter: paperTransactions.balanceAfter, reservedAfter: paperTransactions.reservedAfter }).from(paperTransactions)
    .where(eq(paperTransactions.paperAccountId, accountId)).orderBy(sql`${paperTransactions.sequence} desc`).limit(1);
  const [orders] = await db.select({ reserved: sql<string>`coalesce(sum(${paperOrders.reservedAmount}), 0)::text` }).from(paperOrders)
    .where(and(eq(paperOrders.paperAccountId, accountId), inArray(paperOrders.status, ['PENDING', 'OPEN', 'PARTIALLY_FILLED'])));
  const [positions] = await db.select({ collateral: sql<string>`coalesce(sum(${paperPositions.collateral}), 0)::text` }).from(paperPositions)
    .where(and(eq(paperPositions.paperAccountId, accountId), eq(paperPositions.status, 'OPEN')));

  const s = sums!;
  const mismatches: string[] = [];
  const eq_ = (label: string, a: string, b: string) => { if (dec.cmp(dec.from(a), dec.from(b)) !== 0) mismatches.push(`${label}: account ${dec.from(a)} ≠ ledger ${dec.from(b)}`); };
  eq_('cash', account.currentBalance, s.cash);
  eq_('reserved', account.reservedBalance, s.reserved);
  eq_('realizedPnl', account.realizedPnl, s.realized);
  eq_('totalFees', account.totalFees, s.fees);
  if (last) { eq_('last balance_after', account.currentBalance, last.balanceAfter); eq_('last reserved_after', account.reservedBalance, last.reservedAfter); }
  if (s.entries !== s.maxSequence || s.maxSequence !== account.ledgerSequence) mismatches.push(`sequence: ${s.entries} entries, max ${s.maxSequence}, account ${account.ledgerSequence}`);
  // Positions carry their exact collateral, so this must match to the last digit.
  const expectedReserved = dec.add(dec.from(orders!.reserved), dec.from(positions!.collateral));
  if (dec.cmp(expectedReserved, dec.from(account.reservedBalance)) !== 0) {
    mismatches.push(`reserved vs open orders + positions: ${dec.from(account.reservedBalance)} ≠ ${expectedReserved}`);
  }
  return { ok: mismatches.length === 0, mismatches, ledger: { cash: dec.from(s.cash), reserved: dec.from(s.reserved), realizedPnl: dec.from(s.realized), fees: dec.from(s.fees), entries: s.entries } };
}

export async function ledgerPage(db: Db, accountId: string, limit: number, offset: number) {
  const rows = await db.select().from(paperTransactions).where(eq(paperTransactions.paperAccountId, accountId))
    .orderBy(asc(paperTransactions.sequence)).limit(limit).offset(offset);
  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(paperTransactions).where(eq(paperTransactions.paperAccountId, accountId));
  return { total: total?.n ?? 0, rows };
}
