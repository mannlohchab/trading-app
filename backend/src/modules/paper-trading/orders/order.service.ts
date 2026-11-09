import { eq } from 'drizzle-orm';
import { paperOrders } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Logger } from '../../../logger';
import { dec, type Decimal } from '../../backtesting';
import { normalizeSymbol } from '../../market/domain/rules';
import { LedgerWriter, lockAccount } from '../accounts/ledger';
import { decideFill, isStale } from '../execution/order-fill.engine';
import type { ExecutionSettings } from '../execution/execution.types';
import { endOrder, lockOpenPosition, positionState, type OrderMetadata, type OrderRow, type PaperExecutionEngine } from '../execution/paper-execution.engine';
import { EXECUTION, ORDER_LIMITS, PAPER_CURRENCY, PAPER_EXCHANGE } from '../paper-trading.constants';
import { PaperError } from '../paper-trading.errors';
import type { PaperTradingRepository } from '../paper-trading.repository';
import type { MarketPrices, OrderSource, OrderType, Quote } from '../paper-trading.types';
import { openingQuantity, reducibleQuantity } from '../positions/position-manager';
import { countOpenPositions } from '../positions/position.repository';
import { reservationFor, reservationPrice, validateAgainstSymbol } from './order-manager';
import type { OrderRepository } from './order.repository';

export type PlaceOrderInput = {
  accountId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: OrderType;
  quantity: Decimal;
  price?: Decimal;
  stopPrice?: Decimal;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  reduceOnly?: boolean;
  idempotencyKey?: string;
};
export type PlaceOrderOptions = {
  source?: OrderSource;
  strategyInstanceId?: string;
  strategyVersionId?: string;
  execution?: ExecutionSettings;
  metadata?: OrderMetadata;
};

export const orderView = (o: OrderRow & { symbol: string }) => ({
  id: o.id, accountId: o.paperAccountId, exchange: PAPER_EXCHANGE, symbol: o.symbol, side: o.side, type: o.orderType,
  quantity: dec.from(o.quantity), price: o.price && dec.from(o.price), stopPrice: o.stopPrice && dec.from(o.stopPrice),
  status: o.status, filledQuantity: dec.from(o.filledQuantity), averageFillPrice: o.averageFillPrice && dec.from(o.averageFillPrice),
  commission: dec.from(o.commission), reservedAmount: dec.from(o.reservedAmount), timeInForce: o.timeInForce, reduceOnly: o.reduceOnly,
  source: o.source, strategyInstanceId: o.strategyInstanceId, clientOrderId: o.idempotencyKey, ocoGroup: o.ocoGroup, rejectReason: o.rejectReason,
  createdAt: o.createdAt, updatedAt: o.updatedAt, triggeredAt: o.triggeredAt, filledAt: o.filledAt, cancelledAt: o.cancelledAt,
});

export class OrderService {
  constructor(private readonly deps: {
    db: AppDatabase; repo: PaperTradingRepository; orders: OrderRepository; execution: PaperExecutionEngine; prices: MarketPrices; clock: { now(): Date }; log: Logger;
  }) {}

  /**
   * Places a simulated order: validates it, reserves funds under the account lock, then — for
   * market orders and limits that are already marketable — fills it immediately on a fresh quote.
   * Market orders are refused rather than filled on a stale or missing price.
   */
  async place(userId: string, input: PlaceOrderInput, opts: PlaceOrderOptions = {}) {
    const symbolCode = normalizeSymbol(input.symbol);
    const rules = symbolCode ? await this.deps.repo.symbolRules(PAPER_EXCHANGE, symbolCode) : null;
    if (!rules) throw new PaperError('UNKNOWN_SYMBOL', `${input.symbol} is not an active ${PAPER_EXCHANGE} market.`);
    // Accounts hold USDT: a pair priced in another asset would book foreign-currency amounts as USDT.
    if (rules.quoteAsset !== PAPER_CURRENCY) throw new PaperError('UNKNOWN_SYMBOL', `Paper accounts trade ${PAPER_CURRENCY} pairs only; ${rules.symbol} is priced in ${rules.quoteAsset}.`);
    const execution = opts.execution ?? { commissionPercent: EXECUTION.commissionPercent, slippageBps: EXECUTION.slippageBps };

    let quote: Quote | null = await this.deps.prices.quote(rules);
    const now = this.deps.clock.now();
    if (quote && isStale(quote, now.getTime(), EXECUTION.maxQuoteAgeMs)) quote = null;
    if (input.type === 'MARKET' && !quote) throw new PaperError('STALE_PRICE', `No fresh price for ${rules.symbol}; market orders need a price under ${EXECUTION.maxQuoteAgeMs / 1000} s old.`);

    const draft = { side: input.side, type: input.type, quantity: input.quantity, price: input.price, stopPrice: input.stopPrice };
    const reference = input.type === 'LIMIT' ? input.price! : input.type === 'STOP_MARKET' ? input.stopPrice! : (input.side === 'BUY' ? quote!.ask ?? quote!.last : quote!.bid ?? quote!.last);
    const fields = validateAgainstSymbol(draft, rules, reference);
    if (Object.keys(fields).length) throw new PaperError('INVALID_ORDER', 'The order does not meet the symbol\'s trading rules.', { fields });
    if (input.type === 'STOP_MARKET' && quote) {
      const wrongSide = input.side === 'BUY' ? dec.cmp(input.stopPrice!, quote.last) <= 0 : dec.cmp(input.stopPrice!, quote.last) >= 0;
      if (wrongSide) throw new PaperError('INVALID_ORDER', `A ${input.side} stop must be ${input.side === 'BUY' ? 'above' : 'below'} the current price ${quote.last}.`, { fields: { stopPrice: 'Would trigger immediately.' } });
    }
    const marketableOnArrival = input.type === 'LIMIT' && !!quote && decideFill(
      { side: input.side, type: 'LIMIT', limitPrice: input.price!, stopPrice: null, triggered: false, marketableOnArrival: true }, quote, now.getTime(), { ...execution, maxQuoteAgeMs: EXECUTION.maxQuoteAgeMs, tickSize: rules.tickSize },
    ).kind === 'fill';

    const order = await this.deps.db.transaction(async tx => {
      const account = await lockAccount(tx, input.accountId, userId);
      if (!account) throw new PaperError('NOT_FOUND', 'Paper account not found.');
      if (account.status !== 'ACTIVE' && opts.source !== 'CLOSE' && opts.source !== 'LIQUIDATION') {
        throw new PaperError('ACCOUNT_NOT_ACTIVE', `The account is ${account.status.toLowerCase()}; it cannot take new orders.`);
      }
      if (input.idempotencyKey) {
        const existing = await this.deps.orders.byIdempotencyKey(tx, account.id, input.idempotencyKey);
        if (existing) return { row: existing, duplicate: true };
      }
      if (!opts.source || opts.source === 'USER') {
        const recent = await this.deps.orders.countSince(tx, account.id, new Date(now.getTime() - 60_000));
        if (recent >= ORDER_LIMITS.maxOrdersPerMinute) throw new PaperError('RATE_LIMITED', `At most ${ORDER_LIMITS.maxOrdersPerMinute} orders per minute per account.`);
      }
      if ((await this.deps.orders.countOpen(tx, account.id)) >= ORDER_LIMITS.maxOpenOrdersPerAccount) {
        throw new PaperError('LIMIT_EXCEEDED', `At most ${ORDER_LIMITS.maxOpenOrdersPerAccount} open orders per account.`);
      }
      const positionRow = await lockOpenPosition(tx, account.id, rules.id);
      const position = positionRow && positionState(positionRow);
      const reduceOnly = input.reduceOnly ?? false;
      if (reduceOnly && dec.isZero(reducibleQuantity(position, input.side, input.quantity))) {
        throw new PaperError('NO_POSITION', 'A reduce-only order needs an opposite open position to reduce.');
      }
      const opening = openingQuantity(position, input.side, input.quantity, reduceOnly);
      if (!positionRow && dec.cmp(opening, '0') > 0 && (await countOpenPositions(tx, account.id)) >= ORDER_LIMITS.maxOpenPositionsPerAccount) {
        throw new PaperError('LIMIT_EXCEEDED', `At most ${ORDER_LIMITS.maxOpenPositionsPerAccount} open positions per account.`);
      }
      // Reduce-only orders reserve nothing: they only release collateral. Their fee is paid from cash at fill.
      const reserve = reduceOnly ? '0' : reservationFor(opening, input.quantity, reservationPrice(draft, quote && reference), execution.commissionPercent);

      const [row] = await tx.insert(paperOrders).values({
        paperAccountId: account.id, userId, symbolId: rules.id, side: input.side, orderType: input.type, quantity: input.quantity,
        price: input.price ?? null, stopPrice: input.stopPrice ?? null, status: input.type === 'MARKET' ? 'PENDING' : 'OPEN',
        timeInForce: input.timeInForce ?? 'GTC', reduceOnly, idempotencyKey: input.idempotencyKey ?? null,
        source: opts.source ?? 'USER', strategyInstanceId: opts.strategyInstanceId ?? null, strategyVersionId: opts.strategyVersionId ?? null,
        reservedAmount: reserve, metadata: { ...opts.metadata, execution, marketableOnArrival }, createdAt: now,
      }).returning();
      const ledger = new LedgerWriter(tx, account, now);
      if (!dec.isZero(reserve)) ledger.reserve(`order:${row!.id}:reserve`, reserve, row!.id, `Reserved for ${input.type} ${input.side} ${input.quantity} ${rules.symbol}`);
      await ledger.commit();
      return { row: row!, duplicate: false };
    });

    if (order.duplicate) return { order: orderView((await this.deps.orders.get(order.row.id))!), duplicate: true };
    this.deps.log('info', 'Paper order created', { orderId: order.row.id, accountId: input.accountId, symbol: rules.symbol, side: input.side, type: input.type, quantity: input.quantity, source: opts.source ?? 'USER' });

    // Immediate execution: market orders and marketable limits fill now on the fresh quote.
    if (quote && (input.type === 'MARKET' || marketableOnArrival)) {
      await this.deps.execution.fill(order.row.id, quote);
    } else if (input.type === 'LIMIT' && input.timeInForce && input.timeInForce !== 'GTC') {
      await this.endIfOpen(order.row.id, 'EXPIRED', `${input.timeInForce} limit order was not immediately executable`);
    }
    return { order: orderView((await this.deps.orders.get(order.row.id))!), duplicate: false };
  }

  async cancel(userId: string, orderId: string) {
    const existing = await this.deps.orders.getForUser(userId, orderId);
    if (!existing) throw new PaperError('NOT_FOUND', 'Order not found.');
    const ended = await this.endIfOpen(orderId, 'CANCELLED', 'Cancelled by user');
    if (!ended) throw new PaperError('NOT_CANCELLABLE', `This order is already ${existing.status.toLowerCase()}.`, { status: existing.status });
    this.deps.log('info', 'Paper order cancelled', { orderId });
    return orderView((await this.deps.orders.get(orderId))!);
  }

  /** Ends an open order (account lock first, then the order). Returns false if it was no longer open. */
  async endIfOpen(orderId: string, status: 'CANCELLED' | 'EXPIRED' | 'REJECTED', reason: string): Promise<boolean> {
    return this.deps.db.transaction(async tx => {
      const [peek] = await tx.select({ accountId: paperOrders.paperAccountId }).from(paperOrders).where(eq(paperOrders.id, orderId));
      if (!peek) return false;
      const account = (await lockAccount(tx, peek.accountId))!;
      const [order] = await tx.select().from(paperOrders).where(eq(paperOrders.id, orderId)).for('update');
      if (!order || !['PENDING', 'OPEN', 'PARTIALLY_FILLED'].includes(order.status)) return false;
      const ledger = new LedgerWriter(tx, account, this.deps.clock.now());
      await endOrder(tx, ledger, order, status, reason, this.deps.clock.now());
      await ledger.commit();
      return true;
    });
  }

  async get(userId: string, id: string) {
    const o = await this.deps.orders.getForUser(userId, id);
    if (!o) throw new PaperError('NOT_FOUND', 'Order not found.');
    return orderView(o);
  }

  async list(userId: string, f: Parameters<OrderRepository['list']>[1]) {
    const { total, rows } = await this.deps.orders.list(userId, f);
    return { orders: rows.map(orderView), total, limit: f.limit, offset: f.offset };
  }
}
