// Simulated execution against market data. Never sends anything to an exchange.
//
// Every fill is one database transaction. Lock order (the same in every mutating path of the module,
// so concurrent operations cannot deadlock): the ACCOUNT row first, then ORDER rows, then the open
// POSITION row. The order is re-checked under its lock, so duplicate market events cannot fill it
// twice; ledger entry keys are unique per account as a second guard against double posting.
import { and, eq, inArray, ne } from 'drizzle-orm';
import { paperOrders, paperPositions } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Logger } from '../../../logger';
import { dec, type Decimal } from '../../backtesting';
import { LedgerWriter, lockAccount } from '../accounts/ledger';
import { EXECUTION } from '../paper-trading.constants';
import { PaperError } from '../paper-trading.errors';
import type { PaperTradingRepository, Tx } from '../paper-trading.repository';
import type { OrderSide, Quote } from '../paper-trading.types';
import { applyFill, reducibleQuantity, type PositionState } from '../positions/position-manager';
import { commissionFor, decideFill } from './order-fill.engine';
import type { ExecutionSettings } from './execution.types';

export type OrderRow = typeof paperOrders.$inferSelect;
export type PositionRow = typeof paperPositions.$inferSelect;
export type OrderMetadata = {
  execution?: ExecutionSettings;
  marketableOnArrival?: boolean;
  /** Strategy entries: protective orders to place once filled. */
  protective?: { stopLossPercent?: number; takeProfitPercent?: number };
  fill?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FillOutcome =
  | { outcome: 'filled'; orderId: string; price: Decimal; quantity: Decimal; fee: Decimal; realizedPnl: Decimal; positionId: string | null }
  | { outcome: 'triggered' | 'waiting' | 'stale' | 'skipped'; orderId: string; reason?: string }
  | { outcome: 'cancelled' | 'rejected'; orderId: string; reason: string };

export type ExecutionMetrics = { fills: number; rejectedFills: number; failures: number; fillLatencyMs: number[] };

class FillRejected extends Error {
  constructor(readonly reason: string) { super(reason); }
}

export const settingsOf = (order: OrderRow): ExecutionSettings =>
  (order.metadata as OrderMetadata).execution ?? { commissionPercent: EXECUTION.commissionPercent, slippageBps: EXECUTION.slippageBps };

export const positionState = (p: PositionRow): PositionState => ({
  side: p.side, quantity: dec.from(p.quantity), averageEntryPrice: dec.from(p.averageEntryPrice), collateral: dec.from(p.collateral),
});

export async function lockOpenPosition(tx: Tx, accountId: string, symbolId: string) {
  const [row] = await tx.select().from(paperPositions)
    .where(and(eq(paperPositions.paperAccountId, accountId), eq(paperPositions.symbolId, symbolId), eq(paperPositions.status, 'OPEN'))).for('update');
  return row ?? null;
}

/** Ends an open order (cancel, expire or reject) and releases its reservation. Caller holds the order lock. */
export async function endOrder(tx: Tx, ledger: LedgerWriter, order: OrderRow, status: 'CANCELLED' | 'EXPIRED' | 'REJECTED', reason: string, now: Date) {
  const reserved = dec.from(order.reservedAmount);
  if (!dec.isZero(reserved)) ledger.release(`order:${order.id}:release`, reserved, order.id, `Order ${status.toLowerCase()}: ${reason}`);
  await tx.update(paperOrders).set({ status, reservedAmount: '0', rejectReason: reason, cancelledAt: now }).where(eq(paperOrders.id, order.id));
}

export class PaperExecutionEngine {
  readonly metrics: ExecutionMetrics = { fills: 0, rejectedFills: 0, failures: 0, fillLatencyMs: [] };

  constructor(private readonly deps: { db: AppDatabase; repo: PaperTradingRepository; clock: { now(): Date }; log: Logger }) {}

  /** Tries to execute an open order against `quote`. Safe to call repeatedly and concurrently. */
  async fill(orderId: string, quote: Quote): Promise<FillOutcome> {
    const started = performance.now();
    try {
      const result = await this.deps.db.transaction(tx => this.fillInTx(tx, orderId, quote));
      if (result.outcome === 'filled') {
        this.metrics.fills++;
        this.metrics.fillLatencyMs.push(performance.now() - started);
        if (this.metrics.fillLatencyMs.length > 500) this.metrics.fillLatencyMs.shift();
        this.deps.log('info', 'Paper order filled', { orderId, price: result.price, quantity: result.quantity, fee: result.fee, realizedPnl: result.realizedPnl });
      }
      return result;
    } catch (error) {
      if (error instanceof FillRejected) {
        this.metrics.rejectedFills++;
        await this.deps.db.transaction(async tx => {
          const [peek] = await tx.select({ accountId: paperOrders.paperAccountId }).from(paperOrders).where(eq(paperOrders.id, orderId));
          if (!peek) return;
          const account = (await lockAccount(tx, peek.accountId))!;
          const [order] = await tx.select().from(paperOrders).where(eq(paperOrders.id, orderId)).for('update');
          if (!order || !['PENDING', 'OPEN'].includes(order.status)) return;
          const ledger = new LedgerWriter(tx, account, this.deps.clock.now());
          await endOrder(tx, ledger, order, 'REJECTED', error.reason, this.deps.clock.now());
          await ledger.commit();
        });
        this.deps.log('warn', 'Paper order rejected at fill', { orderId, reason: error.reason });
        return { outcome: 'rejected', orderId, reason: error.reason };
      }
      this.metrics.failures++;
      this.deps.log('error', 'Paper order execution failed', { orderId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async fillInTx(tx: Tx, orderId: string, quote: Quote): Promise<FillOutcome> {
    const now = this.deps.clock.now();
    const [peek] = await tx.select({ accountId: paperOrders.paperAccountId, status: paperOrders.status }).from(paperOrders).where(eq(paperOrders.id, orderId));
    if (!peek || !['PENDING', 'OPEN'].includes(peek.status)) return { outcome: 'skipped', orderId, reason: peek ? `order is ${peek.status}` : 'not found' };
    const account = (await lockAccount(tx, peek.accountId))!; // account first (lock order)
    const [order] = await tx.select().from(paperOrders).where(eq(paperOrders.id, orderId)).for('update');
    if (!order || !['PENDING', 'OPEN'].includes(order.status)) return { outcome: 'skipped', orderId, reason: order ? `order is ${order.status}` : 'not found' };
    if (order.side !== 'BUY' && order.side !== 'SELL') return { outcome: 'skipped', orderId, reason: 'unsupported side' };
    if (order.orderType === 'STOP_LIMIT') return { outcome: 'skipped', orderId, reason: 'unsupported type' };
    const rules = await this.deps.repo.symbolRulesById(order.symbolId, tx);
    if (!rules) throw new FillRejected('Symbol is no longer tradable');
    const meta = order.metadata as OrderMetadata;
    const settings = settingsOf(order);

    const forFill = {
      side: order.side, type: order.orderType, limitPrice: order.price && dec.from(order.price), stopPrice: order.stopPrice && dec.from(order.stopPrice),
      triggered: order.triggeredAt !== null, marketableOnArrival: meta.marketableOnArrival === true,
    };
    let decision = decideFill(forFill, quote, now.getTime(), { ...settings, maxQuoteAgeMs: EXECUTION.maxQuoteAgeMs, tickSize: rules.tickSize });
    let triggeredAt = order.triggeredAt;
    if (decision.kind === 'trigger') {
      triggeredAt = now;
      decision = decideFill({ ...forFill, triggered: true }, quote, now.getTime(), { ...settings, maxQuoteAgeMs: EXECUTION.maxQuoteAgeMs, tickSize: rules.tickSize });
    }
    if (decision.kind === 'stale') return { outcome: 'stale', orderId, reason: `quote is ${decision.ageMs} ms old` };
    if (decision.kind !== 'fill') return { outcome: 'waiting', orderId };

    const ledger = new LedgerWriter(tx, account, now);
    const positionRow = await lockOpenPosition(tx, order.paperAccountId, order.symbolId);
    const position = positionRow && positionState(positionRow);
    const side = order.side as OrderSide;

    let quantity = dec.from(order.quantity);
    if (order.reduceOnly) {
      quantity = reducibleQuantity(position, side, quantity);
      if (dec.isZero(quantity)) {
        await endOrder(tx, ledger, order, 'CANCELLED', 'No position left to reduce', now);
        await ledger.commit();
        return { outcome: 'cancelled', orderId, reason: 'No position left to reduce' };
      }
    }
    if (account.status === 'CLOSED') throw new FillRejected('Account is closed');

    const price = decision.price;
    const effect = applyFill(position, side, quantity, price);
    const fee = commissionFor(quantity, price, settings.commissionPercent);
    const reserved = dec.from(order.reservedAmount);

    // New exposure must be covered by what is available once this order's own reservation is freed.
    const availableAfter = dec.sub(dec.add(dec.add(dec.add(ledger.available, reserved), effect.marginReleased), effect.realizedPnl), dec.add(fee, effect.marginAdded));
    if (dec.cmp(effect.openedQuantity, '0') > 0 && dec.isNegative(availableAfter)) {
      throw new FillRejected(`Insufficient available balance at fill (${dec.round(availableAfter, 8)} after fill)`);
    }

    const k = `order:${order.id}`;
    const tradeMeta = { side, quantity, price, liquidity: decision.liquidity, symbol: rules.symbol };
    if (!dec.isZero(reserved)) ledger.release(`${k}:release`, reserved, order.id, 'Reservation released on fill');
    ledger.trade(`${k}:fill`, order.id, tradeMeta);
    if (dec.cmp(effect.closedQuantity, '0') > 0) {
      ledger.releaseMargin(`${k}:margin-release`, effect.marginReleased, order.id, { positionId: positionRow!.id, quantity: effect.closedQuantity });
      ledger.realize(`${k}:pnl`, effect.realizedPnl, order.id, { positionId: positionRow!.id, quantity: effect.closedQuantity, price });
    }
    if (dec.cmp(effect.openedQuantity, '0') > 0) ledger.lockMargin(`${k}:margin`, effect.marginAdded, order.id, { quantity: effect.openedQuantity, price });
    if (!dec.isZero(fee)) ledger.fee(`${k}:fee`, fee, order.id, { rate: settings.commissionPercent, notional: dec.mul(quantity, price) });

    // Positions. Fees are split between the closing and opening parts by quantity.
    const feeOnClose = dec.cmp(effect.closedQuantity, '0') > 0 ? dec.div(dec.mul(fee, effect.closedQuantity), quantity) : '0';
    const feeOnOpen = dec.sub(fee, feeOnClose);
    let resultingPositionId: string | null = positionRow?.id ?? null;
    const closesExisting = positionRow && (effect.after === null || effect.reversed);
    if (positionRow) {
      const realized = dec.add(dec.from(positionRow.realizedPnl), effect.realizedPnl);
      const fees = dec.add(dec.from(positionRow.totalFees), effect.reversed ? feeOnClose : fee);
      if (closesExisting) {
        await tx.update(paperPositions).set({ status: 'CLOSED', quantity: '0', collateral: '0', realizedPnl: realized, totalFees: fees, lastMarkPrice: price, lastMarkAt: now, closedAt: now }).where(eq(paperPositions.id, positionRow.id));
      } else {
        await tx.update(paperPositions).set({ quantity: effect.after!.quantity, averageEntryPrice: effect.after!.averageEntryPrice, collateral: effect.after!.collateral, realizedPnl: realized, totalFees: fees, lastMarkPrice: price, lastMarkAt: now }).where(eq(paperPositions.id, positionRow.id));
      }
    }
    if (effect.after && (!positionRow || effect.reversed)) {
      const [created] = await tx.insert(paperPositions).values({
        paperAccountId: order.paperAccountId, symbolId: order.symbolId, side: effect.after.side, quantity: effect.after.quantity,
        averageEntryPrice: effect.after.averageEntryPrice, collateral: effect.after.collateral,
        totalFees: positionRow ? feeOnOpen : fee, lastMarkPrice: price, lastMarkAt: now, openedAt: now,
      }).returning({ id: paperPositions.id });
      resultingPositionId = created!.id;
    }

    await tx.update(paperOrders).set({
      status: 'FILLED', filledQuantity: quantity, averageFillPrice: price, commission: fee, reservedAmount: '0', triggeredAt, filledAt: now,
      metadata: { ...meta, fill: { quote, liquidity: decision.liquidity, reference: decision.reference, realizedPnl: effect.realizedPnl, positionId: resultingPositionId } },
    }).where(eq(paperOrders.id, order.id));

    // Linked orders: a closed or reversed position takes its reduce-only orders with it; OCO siblings go too.
    const toCancel = await tx.select().from(paperOrders).where(and(
      eq(paperOrders.paperAccountId, order.paperAccountId), eq(paperOrders.symbolId, order.symbolId), ne(paperOrders.id, order.id),
      inArray(paperOrders.status, ['PENDING', 'OPEN']),
    )).for('update');
    for (const other of toCancel) {
      const sibling = order.ocoGroup !== null && other.ocoGroup === order.ocoGroup;
      if (sibling || (closesExisting && other.reduceOnly)) {
        await endOrder(tx, ledger, other, 'CANCELLED', sibling ? 'Other order in its OCO group filled' : 'Position closed', now);
      }
    }

    // Strategy entries: bracket the new position with its stop loss / take profit.
    if (meta.protective && effect.after && dec.cmp(effect.openedQuantity, '0') > 0) {
      await this.placeProtective(tx, order, effect.after, meta.protective, rules.tickSize, now);
    }

    await ledger.commit();
    return { outcome: 'filled', orderId: order.id, price, quantity, fee, realizedPnl: effect.realizedPnl, positionId: resultingPositionId };
  }

  private async placeProtective(tx: Tx, entry: OrderRow, position: PositionState, p: NonNullable<OrderMetadata['protective']>, tick: Decimal, now: Date) {
    const exitSide = position.side === 'LONG' ? 'SELL' : 'BUY';
    const group = crypto.randomUUID();
    const avg = position.averageEntryPrice;
    const base: Omit<typeof paperOrders.$inferInsert, 'orderType'> = {
      paperAccountId: entry.paperAccountId, userId: entry.userId, symbolId: entry.symbolId, side: exitSide, quantity: position.quantity,
      status: 'OPEN' as const, source: 'PROTECTIVE' as const, reduceOnly: true, ocoGroup: group, strategyInstanceId: entry.strategyInstanceId,
      strategyVersionId: entry.strategyVersionId, metadata: { execution: settingsOf(entry), entryOrderId: entry.id }, createdAt: now,
    };
    const pct = (n: number) => dec.div(String(n), '100');
    if (p.stopLossPercent !== undefined) {
      const raw = position.side === 'LONG' ? dec.mul(avg, dec.sub('1', pct(p.stopLossPercent))) : dec.mul(avg, dec.add('1', pct(p.stopLossPercent)));
      await tx.insert(paperOrders).values({ ...base, orderType: 'STOP_MARKET', stopPrice: dec.roundToStep(raw, tick), idempotencyKey: `protect:${entry.id}:sl` });
    }
    if (p.takeProfitPercent !== undefined) {
      const raw = position.side === 'LONG' ? dec.mul(avg, dec.add('1', pct(p.takeProfitPercent))) : dec.mul(avg, dec.sub('1', pct(p.takeProfitPercent)));
      await tx.insert(paperOrders).values({ ...base, orderType: 'LIMIT', price: dec.roundToStep(raw, tick), idempotencyKey: `protect:${entry.id}:tp` });
    }
  }
}

export { FillRejected, PaperError };
