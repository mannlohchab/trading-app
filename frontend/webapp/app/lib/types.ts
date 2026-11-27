/** Candle timeframes the backend serves (`elysia-backend` TIMEFRAMES, minus 1M). */
export type Interval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export type Side = "buy" | "sell";

export type OrderType = "market" | "limit" | "stop";

export type OrderStatus = "open" | "filled" | "canceled" | "rejected" | "expired";

export interface Candle {
  /** Open time, unix milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 24h spot statistics for one pair. */
export interface Ticker {
  symbol: string;
  last: number;
  change24h: number;
  changePct24h: number;
  open24h: number;
  high24h: number;
  low24h: number;
  /** Base-asset volume. */
  volume24h: number;
  /** Quote-asset (USDT) volume. */
  quoteVolume24h: number;
  bid: number;
  ask: number;
  /** Exchange time of the update, unix milliseconds (0 when unknown). */
  time: number;
  /** Decimals the price is quoted with. */
  pricePrecision: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  /** Limit price for limit orders, trigger price for stop orders. */
  price: number | null;
  size: number;
  filledSize: number;
  avgFillPrice: number | null;
  commission: number;
  status: OrderStatus;
  /** Status as the backend reports it (PENDING, OPEN, PARTIALLY_FILLED, …). */
  rawStatus: string;
  rejectReason: string | null;
  /** MANUAL, STRATEGY, PROTECTIVE, … */
  source: string;
  cancellable: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: Side;
  price: number;
  size: number;
  time: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  collateral: number;
}

/** The paper account the terminal trades on, valued at current prices. */
export interface Account {
  id: string;
  startingBalance: number;
  /** Cash not tied up in positions or open orders. */
  available: number;
  reserved: number;
  /** Null when some position has no current price. */
  equity: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  totalPnl: number | null;
  totalPnlPct: number | null;
  fees: number;
  positions: Position[];
}

export interface PlaceOrderInput {
  side: Side;
  type: OrderType;
  /** Base-asset quantity as a decimal string. */
  quantity: string;
  /** Limit price (limit orders). */
  price?: string;
  /** Trigger price (stop orders). */
  stopPrice?: string;
}
