import { and, eq } from 'drizzle-orm';
import { db, sqlite } from '../../db';
import { orders, paperAccounts, positions, transactions } from '../../db/schema';
import { AppError, assertFound } from '../../lib/errors';
import { id } from '../../lib/ids';
import { requireInrInstrument } from '../../providers/instruments';
import { getMarketDataProvider } from '../../providers/marketData';

export type PlaceOrderInput = {
  userId: string;
  symbol: string;
  exchange?: string;
  name?: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
};

function nowIso() {
  return new Date().toISOString();
}

export async function getOrCreateAccount(userId: string) {
  let account = await db.query.paperAccounts.findFirst({ where: eq(paperAccounts.userId, userId) });
  if (!account) throw new AppError(404, 'Paper account not found');
  return account;
}

export async function placeOrder(input: PlaceOrderInput) {
  if (input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    throw new AppError(400, 'Quantity must be a positive integer');
  }
  if (input.orderType === 'LIMIT' && !(input.limitPrice && input.limitPrice > 0)) {
    throw new AppError(400, 'Limit price required for limit orders');
  }

  const exchange = (input.exchange ?? 'NSE').toUpperCase();
  const symbol = input.symbol.toUpperCase();
  requireInrInstrument(symbol, exchange);
  const quote = await getMarketDataProvider().quote(symbol, exchange);
  const name = input.name ?? quote.name;

  const account = await getOrCreateAccount(input.userId);
  const orderId = id();

  if (input.orderType === 'LIMIT') {
    const shouldFill =
      input.side === 'BUY'
        ? quote.ltp <= (input.limitPrice as number)
        : quote.ltp >= (input.limitPrice as number);

    if (!shouldFill) {
      await db.insert(orders).values({
        id: orderId,
        userId: input.userId,
        accountId: account.id,
        symbol,
        exchange,
        name,
        side: input.side,
        orderType: 'LIMIT',
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        status: 'PENDING',
      });
      return { orderId, status: 'PENDING' as const, fillPrice: null };
    }
  }

  const fillPrice = input.orderType === 'LIMIT' ? (input.limitPrice as number) : quote.ltp;
  return fillOrderAtomic({
    orderId,
    userId: input.userId,
    accountId: account.id,
    symbol,
    exchange,
    name,
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    fillPrice,
    limitPrice: input.limitPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
  });
}

function fillOrderAtomic(args: {
  orderId: string;
  userId: string;
  accountId: string;
  symbol: string;
  exchange: string;
  name: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  fillPrice: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}) {
  requireInrInstrument(args.symbol, args.exchange);
  const notional = args.fillPrice * args.quantity;

  const result = sqlite.transaction(() => {
    const account = db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.id, args.accountId))
      .get();
    if (!account) throw new AppError(404, 'Account not found');

    const existing = db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, args.userId),
          eq(positions.symbol, args.symbol),
          eq(positions.exchange, args.exchange),
        ),
      )
      .get();

    let realizedDelta = 0;

    if (args.side === 'BUY') {
      if (account.cashBalance < notional) {
        throw new AppError(400, 'Insufficient virtual cash');
      }
      db.update(paperAccounts)
        .set({ cashBalance: account.cashBalance - notional, updatedAt: nowIso() })
        .where(eq(paperAccounts.id, args.accountId))
        .run();

      if (existing) {
        const newQty = existing.quantity + args.quantity;
        const newAvg = (existing.avgPrice * existing.quantity + args.fillPrice * args.quantity) / newQty;
        db.update(positions)
          .set({
            quantity: newQty,
            avgPrice: Number(newAvg.toFixed(4)),
            stopLoss: args.stopLoss ?? existing.stopLoss,
            takeProfit: args.takeProfit ?? existing.takeProfit,
            updatedAt: nowIso(),
          })
          .where(eq(positions.id, existing.id))
          .run();
      } else {
        db.insert(positions)
          .values({
            id: id(),
            userId: args.userId,
            accountId: args.accountId,
            symbol: args.symbol,
            exchange: args.exchange,
            name: args.name,
            quantity: args.quantity,
            avgPrice: args.fillPrice,
            stopLoss: args.stopLoss,
            takeProfit: args.takeProfit,
          })
          .run();
      }
    } else {
      if (!existing || existing.quantity < args.quantity) {
        throw new AppError(400, 'Insufficient position quantity to sell');
      }
      realizedDelta = (args.fillPrice - existing.avgPrice) * args.quantity;
      db.update(paperAccounts)
        .set({
          cashBalance: account.cashBalance + notional,
          realizedPnl: account.realizedPnl + realizedDelta,
          updatedAt: nowIso(),
        })
        .where(eq(paperAccounts.id, args.accountId))
        .run();

      const remaining = existing.quantity - args.quantity;
      if (remaining === 0) {
        db.delete(positions).where(eq(positions.id, existing.id)).run();
      } else {
        db.update(positions)
          .set({ quantity: remaining, updatedAt: nowIso() })
          .where(eq(positions.id, existing.id))
          .run();
      }
    }

    db.insert(orders)
      .values({
        id: args.orderId,
        userId: args.userId,
        accountId: args.accountId,
        symbol: args.symbol,
        exchange: args.exchange,
        name: args.name,
        side: args.side,
        orderType: args.orderType,
        quantity: args.quantity,
        limitPrice: args.limitPrice,
        stopLoss: args.stopLoss,
        takeProfit: args.takeProfit,
        status: 'FILLED',
        filledQty: args.quantity,
        avgFillPrice: args.fillPrice,
        updatedAt: nowIso(),
      })
      .run();

    db.insert(transactions)
      .values({
        id: id(),
        userId: args.userId,
        accountId: args.accountId,
        orderId: args.orderId,
        type: args.side,
        symbol: args.symbol,
        exchange: args.exchange,
        quantity: args.quantity,
        price: args.fillPrice,
        amount: notional,
        realizedPnl: realizedDelta,
      })
      .run();

    return { orderId: args.orderId, status: 'FILLED' as const, fillPrice: args.fillPrice, realizedPnl: realizedDelta };
  });

  return result();
}

export async function cancelOrder(userId: string, orderId: string) {
  const order = assertFound(
    await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
    }),
  );
  if (order.status !== 'PENDING') throw new AppError(400, 'Only pending orders can be cancelled');
  await db.update(orders).set({ status: 'CANCELLED', updatedAt: nowIso() }).where(eq(orders.id, orderId));
  return { ok: true };
}

export async function processPendingOrders() {
  const pending = await db.query.orders.findMany({ where: eq(orders.status, 'PENDING') });
  for (const order of pending) {
    try {
      requireInrInstrument(order.symbol, order.exchange);
      const quote = await getMarketDataProvider().quote(order.symbol, order.exchange);
      const limit = order.limitPrice ?? 0;
      const shouldFill =
        order.side === 'BUY' ? quote.ltp <= limit : quote.ltp >= limit;
      if (!shouldFill) continue;
      // Cancel pending then fill as new atomic path by updating status and applying fill
      await db.update(orders).set({ status: 'CANCELLED', updatedAt: nowIso() }).where(eq(orders.id, order.id));
      fillOrderAtomic({
        orderId: id(),
        userId: order.userId,
        accountId: order.accountId,
        symbol: order.symbol,
        exchange: order.exchange,
        name: order.name,
        side: order.side as 'BUY' | 'SELL',
        orderType: 'LIMIT',
        quantity: order.quantity,
        fillPrice: limit,
        limitPrice: limit,
        stopLoss: order.stopLoss ?? undefined,
        takeProfit: order.takeProfit ?? undefined,
      });
    } catch (err) {
      console.warn('Pending order processing failed', order.id, err);
    }
  }
}

export async function portfolioSummary(userId: string) {
  const account = await getOrCreateAccount(userId);
  const openPositions = await db.query.positions.findMany({ where: eq(positions.userId, userId) });
  const quotes = openPositions.length
    ? await getMarketDataProvider().quotes(openPositions.map((p) => ({ symbol: p.symbol, exchange: p.exchange })))
    : [];
  const qmap = new Map(quotes.map((q) => [`${q.exchange}:${q.symbol}`, q]));

  let invested = 0;
  let marketValue = 0;
  const enriched = openPositions.map((p) => {
    const q = qmap.get(`${p.exchange}:${p.symbol}`);
    if (!q) throw new AppError(503, `Market quote unavailable for ${p.symbol} on ${p.exchange}`, 'MARKET_DATA_UNAVAILABLE');
    const ltp = q.ltp;
    const value = ltp * p.quantity;
    const cost = p.avgPrice * p.quantity;
    invested += cost;
    marketValue += value;
    return {
      ...p,
      ltp,
      marketValue: value,
      unrealizedPnl: value - cost,
      unrealizedPnlPercent: cost ? ((value - cost) / cost) * 100 : 0,
      dayChangePercent: q?.changePercent ?? 0,
    };
  });

  const unrealizedPnl = marketValue - invested;
  const equity = account.cashBalance + marketValue;

  return {
    cashBalance: account.cashBalance,
    startingBalance: account.startingBalance,
    invested,
    marketValue,
    equity,
    unrealizedPnl,
    realizedPnl: account.realizedPnl,
    totalPnl: unrealizedPnl + account.realizedPnl,
    totalPnlPercent: account.startingBalance
      ? ((equity - account.startingBalance) / account.startingBalance) * 100
      : 0,
    positions: enriched,
    isDemo: getMarketDataProvider().isDemo,
  };
}
