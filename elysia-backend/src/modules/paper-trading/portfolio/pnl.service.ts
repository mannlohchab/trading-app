// P/L and portfolio arithmetic (pure, exact decimals).
import { dec, type Decimal } from '../../backtesting';
import type { PositionState } from '../positions/position-manager';

export function unrealizedPnl(position: PositionState, mark: Decimal): Decimal {
  const perUnit = position.side === 'LONG' ? dec.sub(mark, position.averageEntryPrice) : dec.sub(position.averageEntryPrice, mark);
  return dec.mul(perUnit, position.quantity);
}

/** Absolute market value of a position at the mark. */
export const exposure = (position: PositionState, mark: Decimal) => dec.mul(position.quantity, mark);

/** Loss as a share of collateral (cost basis): 1 means the collateral is gone. */
export function lossRatio(position: PositionState, mark: Decimal): Decimal {
  const pnl = unrealizedPnl(position, mark);
  if (!dec.isNegative(pnl)) return '0';
  return dec.div(dec.abs(pnl), dec.mul(position.quantity, position.averageEntryPrice));
}

export const returnPercent = (equity: Decimal, initial: Decimal) => (dec.isZero(initial) ? '0' : dec.round(dec.percent(dec.sub(equity, initial), initial), 8));
