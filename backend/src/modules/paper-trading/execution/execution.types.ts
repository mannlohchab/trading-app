import type { Decimal } from '../../backtesting';
import type { OrderSide, OrderType } from '../paper-trading.types';

/** What the fill rules need to know about an order. */
export type OrderForFill = {
  side: OrderSide;
  type: OrderType;
  limitPrice: Decimal | null;
  stopPrice: Decimal | null;
  /** STOP_MARKET orders that already triggered are executed as market orders. */
  triggered: boolean;
  /** A LIMIT order that could already execute when it arrived takes the current price (taker). */
  marketableOnArrival: boolean;
};

export type ExecutionSettings = { commissionPercent: Decimal; slippageBps: number };

export type FillDecision =
  | { kind: 'wait'; reason: 'NOT_TRIGGERED' | 'NOT_REACHED' }
  | { kind: 'stale'; ageMs: number }
  | { kind: 'trigger' }
  | { kind: 'fill'; price: Decimal; liquidity: 'taker' | 'maker'; reference: Decimal };
