// Paper trading against the backend (`/api/v1/paper`): virtual funds, live Binance prices.
// The backend is the authority on balances and fills; the checks here only explain problems early.
import { api } from './api';
import { DEMO_MODE } from './demoMode';
import { pairName } from './marketData';

export type PaperQuote = { ltp: number; asOf?: number; stale?: boolean; marketOpen?: boolean };
export type PaperPosition = {
  id: string; symbol: string; exchange: string; name: string; side?: 'LONG' | 'SHORT'; quantity: number; avgPrice: number;
  availableQuantity: number; reservedQuantity: number; ltp: number | null; marketValue: number | null;
  unrealizedPnl: number | null; unrealizedPnlPercent: number | null; valuationStatus: string;
};
export type PaperPortfolio = {
  /** Cash not tied up in positions (includes funds held for open orders). */
  cashBalance: number; availableCash: number; reservedCash: number; startingBalance: number; invested: number;
  equity: number | null; marketValue: number | null; unrealizedPnl: number | null;
  realizedPnl: number; totalPnl: number | null; totalPnlPercent: number | null; totalFees?: number;
  valuationStatus: string; positions: PaperPosition[];
};
export type PaperOrder = {
  id: string; symbol: string; exchange: string; name: string; side: string; orderType: string; source?: string;
  quantity: number; limitPrice: number | null; avgFillPrice: number | null; status: string; rejectReason?: string | null;
  /** Open orders that can still be cancelled. */
  cancellable: boolean;
};
export type PaperActivity = {
  id: string; type: string; symbol: string | null; quantity: number | null; price: number | null; amount: number;
  realizedPnl: number | null; createdAt: string;
};
type Balance = { availableCash: number; positions: { symbol: string; exchange: string; availableQuantity: number }[] };
export type OrderDraft = { symbol: string; exchange: string; side: 'BUY' | 'SELL'; orderType: 'MARKET' | 'LIMIT'; quantity: string; limitPrice: string };

/** Mirrors the backend's reservation: 0.1% commission, plus a 2% price buffer on market buys. */
export const COMMISSION_RATE = 0.001;
export const MARKET_BUFFER = 0.02;

export function sellableQuantity(portfolio: Balance | undefined, symbol: string, exchange: string) {
  return portfolio?.positions.find(p => p.symbol === symbol && p.exchange === exchange)?.availableQuantity ?? 0;
}
export function requiredCash(orderType: 'MARKET' | 'LIMIT', price: number, quantity: number) {
  return price * quantity * (orderType === 'MARKET' ? 1 + MARKET_BUFFER : 1) * (1 + COMMISSION_RATE);
}
export function orderProblem(input: OrderDraft & { portfolio?: Balance; quote?: PaperQuote; isDemo?: boolean; now?: number }) {
  if (input.isDemo) return 'Demo preview is read-only. Sign in to the connected app to place paper trades.';
  if (!input.portfolio || !Number.isFinite(input.portfolio.availableCash)) return 'Waiting for your backend account balance.';
  const q = input.quote;
  if (!q || !Number.isFinite(q.ltp) || q.ltp <= 0) return 'A current quote is required to place an order.';
  const age = ((input.now ?? Date.now()) / 1000) - (q.asOf ?? 0);
  if (q.stale || age > 120 || age < -60) return 'The quote is delayed. Refresh prices before trading.';
  if (q.marketOpen === false) return 'This market is closed. Try again when it opens.';
  const quantity = Number(input.quantity.trim());
  if (!/^\d*\.?\d{0,8}$/.test(input.quantity.trim()) || !Number.isFinite(quantity) || quantity <= 0) return 'Enter a positive quantity with up to 8 decimals.';
  const price = input.orderType === 'LIMIT' ? Number(input.limitPrice) : q.ltp;
  if (!Number.isFinite(price) || price <= 0) return 'Enter a positive limit price.';
  if (input.side === 'BUY') {
    const needed = requiredCash(input.orderType, price, quantity);
    if (!Number.isFinite(needed) || needed > input.portfolio.availableCash + 1e-8) return 'This order exceeds your available virtual cash (including the 0.1% fee).';
  }
  if (input.side === 'SELL' && quantity > sellableQuantity(input.portfolio, input.symbol, input.exchange)) return 'You do not own enough available quantity of this pair to sell.';
  return null;
}

// ---- Backend shapes

type BackendAccount = { id: string; name: string; status: string; currency: string };
type BackendPosition = {
  id: string; exchange: string; symbol: string; side: 'LONG' | 'SHORT'; status: string; quantity: string; averageEntryPrice: string;
  collateral: string; markPrice: string | null; unrealizedPnl: string | null; exposure: string;
};
type BackendPortfolio = {
  accountId: string; initialBalance: string; cashBalance: string; availableBalance: string; reservedBalance: string; totalEquity: string;
  realizedPnl: string; unrealizedPnl: string; totalFees: string; netPnl: string; returnPercent: string;
  openPositions: BackendPosition[]; unpricedSymbols: string[];
};
type BackendOrder = {
  id: string; exchange: string; symbol: string; side: 'BUY' | 'SELL'; type: string; quantity: string; price: string | null;
  stopPrice: string | null; status: string; filledQuantity: string; averageFillPrice: string | null; commission: string;
  source: string; rejectReason: string | null; createdAt: string; filledAt: string | null;
};

const n = (value: string | null | undefined) => (value == null ? null : Number(value));

/** Starting virtual balance of the account the app creates on first use (USDT, treated as USD). */
export const STARTING_BALANCE = '100000';
let accountRequest: { userId: string; promise: Promise<string> } | null = null;

/** The user's paper account id, creating the account on first use. One request per user at a time. */
export function paperAccountId(userId: string): Promise<string> {
  if (accountRequest?.userId === userId) return accountRequest.promise;
  const promise = (async () => {
    const { accounts } = await api<{ accounts: BackendAccount[] }>('/api/v1/paper/accounts?limit=10');
    const active = accounts.find(a => a.status === 'ACTIVE');
    if (active) return active.id;
    const created = await api<BackendAccount>('/api/v1/paper/accounts', { method: 'POST', body: { name: 'Main', initialBalance: STARTING_BALANCE } });
    return created.id;
  })();
  accountRequest = { userId, promise };
  promise.catch(() => { if (accountRequest?.promise === promise) accountRequest = null; });
  return promise;
}

function toPosition(p: BackendPosition): PaperPosition {
  const unrealized = n(p.unrealizedPnl);
  const collateral = Number(p.collateral);
  return {
    id: p.id, symbol: p.symbol, exchange: p.exchange, name: pairName(p.symbol), side: p.side,
    quantity: Number(p.quantity), avgPrice: Number(p.averageEntryPrice), availableQuantity: p.side === 'LONG' ? Number(p.quantity) : 0,
    reservedQuantity: 0, ltp: n(p.markPrice),
    // What the position is worth to the account: its collateral plus open profit or loss.
    marketValue: unrealized === null ? null : collateral + unrealized,
    unrealizedPnl: unrealized, unrealizedPnlPercent: unrealized === null || collateral <= 0 ? null : (unrealized / collateral) * 100,
    valuationStatus: unrealized === null ? 'delayed' : 'current',
  };
}

export function toPortfolio(b: BackendPortfolio): PaperPortfolio {
  const positions = b.openPositions.map(toPosition);
  const invested = b.openPositions.reduce((sum, p) => sum + Number(p.collateral), 0);
  const priced = b.unpricedSymbols.length === 0;
  return {
    cashBalance: Number(b.cashBalance) - invested,
    availableCash: Number(b.availableBalance),
    reservedCash: Number(b.reservedBalance) - invested,
    startingBalance: Number(b.initialBalance),
    invested,
    equity: priced ? Number(b.totalEquity) : null,
    marketValue: priced ? positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0) : null,
    unrealizedPnl: priced ? Number(b.unrealizedPnl) : null,
    realizedPnl: Number(b.realizedPnl),
    totalPnl: priced ? Number(b.netPnl) : null,
    totalPnlPercent: priced ? Number(b.returnPercent) : null,
    totalFees: Number(b.totalFees),
    valuationStatus: priced ? 'current' : 'delayed',
    positions,
  };
}

const OPEN_STATUSES = new Set(['PENDING', 'OPEN', 'PARTIALLY_FILLED']);
function toOrder(o: BackendOrder): PaperOrder {
  return {
    id: o.id, symbol: o.symbol, exchange: o.exchange, name: pairName(o.symbol), side: o.side,
    orderType: o.type === 'STOP_MARKET' ? 'STOP' : o.type, source: o.source, quantity: Number(o.quantity),
    limitPrice: n(o.price ?? o.stopPrice), avgFillPrice: n(o.averageFillPrice),
    status: OPEN_STATUSES.has(o.status) ? 'PENDING' : o.status, rejectReason: o.rejectReason, cancellable: OPEN_STATUSES.has(o.status),
  };
}

// ---- Requests

export async function fetchPortfolio(userId: string, signal?: AbortSignal): Promise<PaperPortfolio> {
  if (DEMO_MODE) return api<PaperPortfolio>('/api/trading/portfolio', { signal });
  const accountId = await paperAccountId(userId);
  return toPortfolio(await api<BackendPortfolio>(`/api/v1/paper/accounts/${accountId}/portfolio`, { signal }));
}

export async function fetchOrders(userId: string, signal?: AbortSignal): Promise<{ orders: PaperOrder[] }> {
  if (DEMO_MODE) {
    const { orders } = await api<{ orders: Omit<PaperOrder, 'cancellable'>[] }>('/api/trading/orders', { signal });
    return { orders: orders.map(o => ({ ...o, cancellable: o.status === 'PENDING' })) };
  }
  const accountId = await paperAccountId(userId);
  const { orders } = await api<{ orders: BackendOrder[] }>(`/api/v1/paper/orders?accountId=${accountId}&limit=30`, { signal });
  return { orders: orders.map(toOrder) };
}

/** Recent fills, newest first, as account activity. */
export async function fetchActivity(userId: string, signal?: AbortSignal): Promise<{ transactions: PaperActivity[] }> {
  if (DEMO_MODE) return api('/api/trading/transactions', { signal });
  const accountId = await paperAccountId(userId);
  const { orders } = await api<{ orders: BackendOrder[] }>(`/api/v1/paper/orders?accountId=${accountId}&status=FILLED&limit=20`, { signal });
  return {
    transactions: orders.map(o => {
      const quantity = Number(o.filledQuantity), price = n(o.averageFillPrice);
      return { id: o.id, type: o.side, symbol: o.symbol, quantity, price, amount: price === null ? 0 : quantity * price,
        realizedPnl: null, createdAt: o.filledAt ?? o.createdAt };
    }),
  };
}

export type PlacedOrder = { order: PaperOrder; fillPrice: number | null };

export async function placeOrder(userId: string, input: {
  symbol: string; side: 'BUY' | 'SELL'; orderType: 'MARKET' | 'LIMIT'; quantity: string; limitPrice?: string; clientOrderId: string;
}): Promise<PlacedOrder> {
  if (DEMO_MODE) throw new Error('Demo preview is read-only.');
  const accountId = await paperAccountId(userId);
  const order = await api<BackendOrder>('/api/v1/paper/orders', {
    method: 'POST',
    body: {
      accountId, symbol: input.symbol, side: input.side, type: input.orderType, quantity: input.quantity,
      ...(input.orderType === 'LIMIT' ? { price: input.limitPrice } : {}),
      // The app only sells what it holds; the backend also supports shorts, which the app does not offer.
      reduceOnly: input.side === 'SELL',
      clientOrderId: input.clientOrderId,
    },
  });
  return { order: toOrder(order), fillPrice: n(order.averageFillPrice) };
}

export async function cancelOrder(orderId: string) {
  if (DEMO_MODE) return api(`/api/trading/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
  return api(`/api/v1/paper/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' });
}

export async function closePosition(positionId: string) {
  return api(`/api/v1/paper/positions/${encodeURIComponent(positionId)}/close`, { method: 'POST' });
}

