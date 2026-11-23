import type { Decimal } from '../backtesting';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET';
export type OrderStatus = 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export type OrderSource = 'USER' | 'STRATEGY' | 'PROTECTIVE' | 'CLOSE' | 'LIQUIDATION';
export type PositionSide = 'LONG' | 'SHORT';

/** Symbol constraints from the Binance catalog. */
export type SymbolRules = {
  id: string;
  exchange: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: Decimal;
  lotSize: Decimal;
  minQuantity: Decimal | null;
  minNotional: Decimal | null;
};

/** A price observation. `bid`/`ask` when the source has them. Times are Unix ms. */
export type Quote = { last: Decimal; bid: Decimal | null; ask: Decimal | null; time: number; source: 'stream' | 'rest' };

export interface MarketPrices {
  /** Latest quote, or null when none is available. Freshness is the caller's decision. */
  quote(symbol: SymbolRules): Promise<Quote | null>;
}
