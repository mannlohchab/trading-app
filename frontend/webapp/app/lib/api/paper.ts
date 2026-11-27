// Paper trading against elysia-backend (`/api/v1/paper`): virtual funds, live Binance prices.
// The backend is the authority on balances and fills; the checks here only explain problems early.
// Ported from app/src/lib/paperTrading.ts, plus stop orders (STOP_MARKET), which the backend supports.
import type { Account, Fill, Order, OrderStatus, OrderType, PlaceOrderInput, Position, Side } from "../types";
import { apiFetch } from "./client";

type BackendAccount = { id: string; name: string; status: string; currency: string };
type BackendPosition = {
  id: string; exchange: string; symbol: string; side: "LONG" | "SHORT"; status: string;
  quantity: string; averageEntryPrice: string; collateral: string; markPrice: string | null;
  unrealizedPnl: string | null; exposure: string;
};
type BackendPortfolio = {
  accountId: string; initialBalance: string; cashBalance: string; availableBalance: string;
  reservedBalance: string; totalEquity: string; realizedPnl: string; unrealizedPnl: string;
  totalFees: string; netPnl: string; returnPercent: string; openPositions: BackendPosition[];
  unpricedSymbols: string[];
};
type BackendOrder = {
  id: string; exchange: string; symbol: string; side: "BUY" | "SELL"; type: string;
  quantity: string; price: string | null; stopPrice: string | null; status: string;
  filledQuantity: string; averageFillPrice: string | null; commission: string; source: string;
  rejectReason: string | null; createdAt: string; filledAt: string | null; updatedAt?: string | null;
};

/** Mirrors the backend's reservation: 0.1% commission, plus a 2% price buffer on market buys. */
export const COMMISSION_RATE = 0.001;
export const MARKET_BUFFER = 0.02;
/** Starting virtual balance of the account created on first use (USDT). */
export const STARTING_BALANCE = "100000";

const n = (value: string | null | undefined) => (value == null ? null : Number(value));
const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0);

let accountRequest: { userId: string; promise: Promise<string> } | null = null;

/** The user's active paper account id, creating it on first use. One request per user at a time. */
export function paperAccountId(userId: string): Promise<string> {
  if (accountRequest?.userId === userId) return accountRequest.promise;
  const promise = (async () => {
    const { accounts } = await apiFetch<{ accounts: BackendAccount[] }>("/api/v1/paper/accounts?limit=10");
    const active = accounts.find((a) => a.status === "ACTIVE");
    if (active) return active.id;
    const created = await apiFetch<BackendAccount>("/api/v1/paper/accounts", {
      method: "POST",
      body: { name: "Main", initialBalance: STARTING_BALANCE },
    });
    return created.id;
  })();
  accountRequest = { userId, promise };
  promise.catch(() => {
    if (accountRequest?.promise === promise) accountRequest = null;
  });
  return promise;
}

/** Forget the cached account, e.g. on sign-out. */
export function resetPaperAccount() {
  accountRequest = null;
}

function toPosition(p: BackendPosition): Position {
  const unrealized = n(p.unrealizedPnl);
  const collateral = Number(p.collateral);
  return {
    id: p.id,
    symbol: p.symbol,
    side: p.side === "SHORT" ? "short" : "long",
    size: Number(p.quantity),
    entryPrice: Number(p.averageEntryPrice),
    markPrice: n(p.markPrice),
    unrealizedPnl: unrealized,
    unrealizedPnlPct: unrealized === null || collateral <= 0 ? null : (unrealized / collateral) * 100,
    collateral,
  };
}

function toAccount(b: BackendPortfolio): Account {
  const priced = b.unpricedSymbols.length === 0;
  return {
    id: b.accountId,
    startingBalance: Number(b.initialBalance),
    available: Number(b.availableBalance),
    reserved: Number(b.reservedBalance),
    equity: priced ? Number(b.totalEquity) : null,
    realizedPnl: Number(b.realizedPnl),
    unrealizedPnl: priced ? Number(b.unrealizedPnl) : null,
    totalPnl: priced ? Number(b.netPnl) : null,
    totalPnlPct: priced ? Number(b.returnPercent) : null,
    fees: Number(b.totalFees),
    positions: b.openPositions.map(toPosition),
  };
}

const OPEN_STATUSES = new Set(["PENDING", "OPEN", "PARTIALLY_FILLED"]);
const STATUS: Record<string, OrderStatus> = {
  FILLED: "filled", CANCELLED: "canceled", REJECTED: "rejected", EXPIRED: "expired",
};
const TYPE: Record<string, OrderType> = { MARKET: "market", LIMIT: "limit", STOP_MARKET: "stop" };

function toOrder(o: BackendOrder): Order {
  const open = OPEN_STATUSES.has(o.status);
  const createdAt = time(o.createdAt);
  return {
    id: o.id,
    symbol: o.symbol,
    side: o.side === "SELL" ? "sell" : "buy",
    type: TYPE[o.type] ?? "market",
    price: n(o.price ?? o.stopPrice),
    size: Number(o.quantity),
    filledSize: Number(o.filledQuantity),
    avgFillPrice: n(o.averageFillPrice),
    commission: Number(o.commission),
    status: open ? "open" : (STATUS[o.status] ?? "canceled"),
    rawStatus: o.status,
    rejectReason: o.rejectReason,
    source: o.source,
    cancellable: open,
    createdAt,
    updatedAt: time(o.filledAt) || time(o.updatedAt) || createdAt,
  };
}

/** Orders that (partly) filled, as fills at their average price. */
export function fillsFromOrders(orders: Order[]): Fill[] {
  return orders.flatMap((o) =>
    o.filledSize > 0 && o.avgFillPrice !== null && o.avgFillPrice > 0
      ? [{ id: o.id, orderId: o.id, symbol: o.symbol, side: o.side, price: o.avgFillPrice, size: o.filledSize, time: o.updatedAt }]
      : [],
  );
}

// ---- Requests

export async function fetchAccount(userId: string, signal?: AbortSignal): Promise<Account> {
  const accountId = await paperAccountId(userId);
  return toAccount(await apiFetch<BackendPortfolio>(`/api/v1/paper/accounts/${accountId}/portfolio`, { signal }));
}

/** Newest first. */
export async function fetchOrders(userId: string, limit = 100, signal?: AbortSignal): Promise<Order[]> {
  const accountId = await paperAccountId(userId);
  const { orders } = await apiFetch<{ orders: BackendOrder[] }>(
    `/api/v1/paper/orders?accountId=${accountId}&limit=${limit}`,
    { signal },
  );
  return orders.map(toOrder);
}

const BACKEND_TYPE: Record<OrderType, string> = { market: "MARKET", limit: "LIMIT", stop: "STOP_MARKET" };

export async function placeOrder(userId: string, symbol: string, input: PlaceOrderInput): Promise<Order> {
  const accountId = await paperAccountId(userId);
  const order = await apiFetch<BackendOrder>("/api/v1/paper/orders", {
    method: "POST",
    body: {
      accountId,
      symbol,
      side: input.side === "sell" ? "SELL" : "BUY",
      type: BACKEND_TYPE[input.type],
      quantity: input.quantity,
      ...(input.type === "limit" ? { price: input.price } : {}),
      ...(input.type === "stop" ? { stopPrice: input.stopPrice } : {}),
      // Spot-style like the mobile app: sells only reduce what you hold, no shorts.
      reduceOnly: input.side === "sell",
      clientOrderId: crypto.randomUUID(),
    },
  });
  return toOrder(order);
}

export async function cancelOrder(orderId: string): Promise<void> {
  await apiFetch(`/api/v1/paper/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
}

export async function closePosition(positionId: string): Promise<void> {
  await apiFetch(`/api/v1/paper/positions/${encodeURIComponent(positionId)}/close`, { method: "POST" });
}

// ---- Pre-checks

export function requiredCash(type: OrderType, price: number, quantity: number): number {
  return price * quantity * (type === "market" ? 1 + MARKET_BUFFER : 1) * (1 + COMMISSION_RATE);
}

/** Quantity of `symbol` that a sell can reduce. */
export function sellableQuantity(account: Account | null, symbol: string): number {
  return account?.positions.find((p) => p.symbol === symbol && p.side === "long")?.size ?? 0;
}

/** Why an order can't go out yet, or null. */
export function orderProblem(input: {
  side: Side;
  type: OrderType;
  quantity: string;
  price: string;
  stopPrice: string;
  last: number;
  quoteTime: number;
  account: Account | null;
  symbol: string;
  now?: number;
}): string | null {
  if (!input.account) return "Waiting for your paper account balance.";
  if (!(input.last > 0)) return "Waiting for a live price.";
  const age = ((input.now ?? Date.now()) - input.quoteTime) / 1000;
  if (input.quoteTime > 0 && (age > 120 || age < -60)) return "The quote is delayed. Wait for prices to refresh.";
  const q = input.quantity.trim();
  const quantity = Number(q);
  if (!/^\d*\.?\d{0,12}$/.test(q) || !Number.isFinite(quantity) || quantity <= 0) return "Enter a positive quantity.";
  let price = input.last;
  if (input.type === "limit") {
    price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) return "Enter a positive limit price.";
  }
  if (input.type === "stop") {
    const stop = Number(input.stopPrice);
    if (!Number.isFinite(stop) || stop <= 0) return "Enter a positive stop price.";
    if (input.side === "buy" && stop <= input.last) return "A buy stop must be above the current price.";
    if (input.side === "sell" && stop >= input.last) return "A sell stop must be below the current price.";
    price = stop;
  }
  if (input.side === "buy") {
    const needed = requiredCash(input.type, price, quantity);
    if (needed > input.account.available + 1e-8) return "This order exceeds your available paper cash (including the 0.1% fee).";
  } else if (quantity > sellableQuantity(input.account, input.symbol) + 1e-12) {
    return "You don't hold enough of this pair to sell.";
  }
  return null;
}
