// One-way position accounting (pure, exact decimals). A position is a signed quantity per account
// and symbol: buys add, sells subtract. Reducing realizes P/L at the average entry price; crossing
// zero reverses into the opposite side at the fill price.
import { dec, type Decimal } from '../../backtesting';
import type { OrderSide, PositionSide } from '../paper-trading.types';

export type PositionState = {
  side: PositionSide;
  quantity: Decimal;
  averageEntryPrice: Decimal;
  /** Exact cost basis (Σ opening quantity × price, minus what was released). */
  collateral: Decimal;
};

export type FillEffect = {
  after: PositionState | null;
  /** Quantity that reduced the existing position. */
  closedQuantity: Decimal;
  /** Quantity that opened or increased a position. */
  openedQuantity: Decimal;
  /** Gross P/L realized on the closed quantity: proceeds minus released cost basis (fees are separate). */
  realizedPnl: Decimal;
  /** Collateral freed: the closed share of the position's exact cost basis (all of it on a full close). */
  marginReleased: Decimal;
  /** Collateral required: opened quantity × fill price (1×, no leverage). */
  marginAdded: Decimal;
  reversed: boolean;
};

const ZERO = '0';
const sideOf = (s: OrderSide): PositionSide => (s === 'BUY' ? 'LONG' : 'SHORT');

export function applyFill(position: PositionState | null, side: OrderSide, quantity: Decimal, price: Decimal): FillEffect {
  if (!(dec.cmp(quantity, ZERO) > 0) || !(dec.cmp(price, ZERO) > 0)) throw new Error('Fill quantity and price must be positive');
  const direction = sideOf(side);
  const notional = dec.mul(quantity, price);

  if (!position || dec.isZero(position.quantity)) {
    return { after: { side: direction, quantity, averageEntryPrice: price, collateral: notional }, closedQuantity: ZERO, openedQuantity: quantity, realizedPnl: ZERO, marginReleased: ZERO, marginAdded: notional, reversed: false };
  }

  if (position.side === direction) {
    const total = dec.add(position.quantity, quantity);
    const collateral = dec.add(position.collateral, notional);
    return {
      after: { side: direction, quantity: total, averageEntryPrice: dec.div(collateral, total), collateral },
      closedQuantity: ZERO, openedQuantity: quantity, realizedPnl: ZERO, marginReleased: ZERO, marginAdded: notional, reversed: false,
    };
  }

  // Opposite direction: reduce, close, or reverse.
  const fullClose = dec.cmp(quantity, position.quantity) >= 0;
  const closed = fullClose ? position.quantity : quantity;
  const released = fullClose ? position.collateral : dec.div(dec.mul(position.collateral, closed), position.quantity);
  const proceeds = dec.mul(closed, price);
  const realizedPnl = position.side === 'LONG' ? dec.sub(proceeds, released) : dec.sub(released, proceeds);
  const opened = dec.sub(quantity, closed);

  if (dec.cmp(opened, ZERO) > 0) {
    const collateral = dec.mul(opened, price);
    return { after: { side: direction, quantity: opened, averageEntryPrice: price, collateral }, closedQuantity: closed, openedQuantity: opened, realizedPnl, marginReleased: released, marginAdded: collateral, reversed: true };
  }
  return {
    after: fullClose ? null : { ...position, quantity: dec.sub(position.quantity, closed), collateral: dec.sub(position.collateral, released) },
    closedQuantity: closed, openedQuantity: ZERO, realizedPnl, marginReleased: released, marginAdded: ZERO, reversed: false,
  };
}

/** Quantity of an order that would open or add to a position (the rest reduces the current one). */
export function openingQuantity(position: PositionState | null, side: OrderSide, quantity: Decimal, reduceOnly: boolean): Decimal {
  if (reduceOnly) return ZERO;
  if (!position || position.side === sideOf(side)) return quantity;
  const excess = dec.sub(quantity, position.quantity);
  return dec.cmp(excess, ZERO) > 0 ? excess : ZERO;
}

/** For reduce-only orders: the part of `quantity` that actually reduces `position`. */
export function reducibleQuantity(position: PositionState | null, side: OrderSide, quantity: Decimal): Decimal {
  if (!position || position.side === sideOf(side)) return ZERO;
  return dec.cmp(quantity, position.quantity) <= 0 ? quantity : position.quantity;
}
