// Simulated fill rules (pure). These are documented assumptions, not a reproduction of exchange
// matching: there is no order book, queue position or partial liquidity.
//
//  Prices: triggers and eligibility use the last trade price; fills use the touch (ask for buys,
//          bid for sells) when the quote has one, else the last price.
//  MARKET: fills at the touch, moved `slippageBps` against the order, rounded to the tick (buys up,
//          sells down). Never on a stale quote.
//  LIMIT:  BUY eligible when ask (or last) ≤ limit; SELL when bid (or last) ≥ limit. A resting order
//          fills at its limit price (maker, no slippage). An order already marketable on arrival
//          fills at the current touch, never worse than its limit (taker, no slippage).
//  STOP_MARKET: BUY triggers when last ≥ stop; SELL when last ≤ stop. It then fills like a market
//          order at the current touch, so a price gap through the stop fills at the gapped price.
import { dec, type Decimal } from '../../backtesting';
import type { Quote } from '../paper-trading.types';
import type { ExecutionSettings, FillDecision, OrderForFill } from './execution.types';

export function isStale(quote: Quote, now: number, maxAgeMs: number) {
  return now - quote.time > maxAgeMs;
}

const touch = (side: OrderForFill['side'], q: Quote) => (side === 'BUY' ? q.ask ?? q.last : q.bid ?? q.last);

/** Market fill price: the touch moved against the order by the slippage, on the tick grid. */
export function marketFillPrice(side: OrderForFill['side'], q: Quote, slippageBps: number, tickSize: Decimal): Decimal {
  const ref = touch(side, q);
  const factor = dec.div(String(slippageBps), '10000');
  const raw = side === 'BUY' ? dec.mul(ref, dec.add('1', factor)) : dec.mul(ref, dec.sub('1', factor));
  const price = side === 'BUY' ? dec.ceilToStep(raw, tickSize) : dec.floorToStep(raw, tickSize);
  return dec.cmp(price, '0') > 0 ? price : tickSize;
}

export function decideFill(order: OrderForFill, quote: Quote, now: number, settings: ExecutionSettings & { maxQuoteAgeMs: number; tickSize: Decimal }): FillDecision {
  if (isStale(quote, now, settings.maxQuoteAgeMs)) return { kind: 'stale', ageMs: now - quote.time };

  if (order.type === 'MARKET' || (order.type === 'STOP_MARKET' && order.triggered)) {
    return { kind: 'fill', price: marketFillPrice(order.side, quote, settings.slippageBps, settings.tickSize), liquidity: 'taker', reference: touch(order.side, quote) };
  }

  if (order.type === 'STOP_MARKET') {
    const stop = order.stopPrice!;
    const hit = order.side === 'BUY' ? dec.cmp(quote.last, stop) >= 0 : dec.cmp(quote.last, stop) <= 0;
    return hit ? { kind: 'trigger' } : { kind: 'wait', reason: 'NOT_TRIGGERED' };
  }

  // LIMIT
  const limit = order.limitPrice!;
  const ref = touch(order.side, quote);
  const reached = order.side === 'BUY' ? dec.cmp(ref, limit) <= 0 : dec.cmp(ref, limit) >= 0;
  if (!reached) return { kind: 'wait', reason: 'NOT_REACHED' };
  if (order.marketableOnArrival) return { kind: 'fill', price: ref, liquidity: 'taker', reference: ref };
  return { kind: 'fill', price: limit, liquidity: 'maker', reference: ref };
}

/** Commission on a fill: notional × percent, rounded up to 8 decimals (never undercharge). */
export function commissionFor(quantity: Decimal, price: Decimal, commissionPercent: Decimal): Decimal {
  const fee = dec.div(dec.mul(dec.mul(quantity, price), commissionPercent), '100');
  return dec.ceilToStep(fee, '0.00000001');
}
