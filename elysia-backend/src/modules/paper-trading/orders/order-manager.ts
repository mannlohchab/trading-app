// Order checks against symbol rules and the reservation an order needs (pure).
import { dec, type Decimal } from '../../backtesting';
import { EXECUTION } from '../paper-trading.constants';
import type { OrderSide, OrderType, SymbolRules } from '../paper-trading.types';
import { commissionFor } from '../execution/order-fill.engine';

export type OrderDraft = { side: OrderSide; type: OrderType; quantity: Decimal; price?: Decimal; stopPrice?: Decimal };

/** Field errors for an order against the symbol's tick, lot, minimum quantity and minimum notional. */
export function validateAgainstSymbol(order: OrderDraft, rules: SymbolRules, referencePrice: Decimal): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!dec.isMultipleOf(order.quantity, rules.lotSize)) errors.quantity = `Quantity must be a multiple of the lot size ${rules.lotSize}.`;
  else if (rules.minQuantity && dec.cmp(order.quantity, rules.minQuantity) < 0) errors.quantity = `Quantity is below the minimum ${rules.minQuantity}.`;
  for (const field of ['price', 'stopPrice'] as const) {
    const v = order[field];
    if (v !== undefined && !dec.isMultipleOf(v, rules.tickSize)) errors[field] = `${field} must be a multiple of the tick size ${rules.tickSize}.`;
  }
  if (!errors.quantity && rules.minNotional && dec.cmp(dec.mul(order.quantity, referencePrice), rules.minNotional) < 0) {
    errors.quantity = `Order value is below the minimum notional ${rules.minNotional} ${rules.quoteAsset}.`;
  }
  return errors;
}

/** Price used to size the reservation: the limit, the stop, or the current price, plus headroom where the fill price is unknown. */
export function reservationPrice(order: OrderDraft, marketPrice: Decimal | null): Decimal {
  const buffer = dec.add('1', dec.div(EXECUTION.reservationBufferPercent, '100'));
  if (order.type === 'LIMIT') return order.price!;
  const base = order.type === 'STOP_MARKET' ? order.stopPrice! : marketPrice!;
  return dec.mul(base, buffer);
}

/**
 * Amount to reserve when the order is placed: collateral for the quantity that would open or add
 * to a position, plus the commission on the whole order.
 */
export function reservationFor(openingQuantity: Decimal, quantity: Decimal, price: Decimal, commissionPercent: Decimal): Decimal {
  return dec.add(dec.mul(openingQuantity, price), commissionFor(quantity, price, commissionPercent));
}
