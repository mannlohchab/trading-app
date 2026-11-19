// Prices for holdings from the market module (spot pairs quoted in USDT).
import type { PriceSource } from '../application/ports';

type Market = {
  isActiveInstrument(exchange: string, symbol: string): Promise<boolean>;
  tickersFor(exchange: string, symbols: string[]): Promise<{ symbol: string; lastPrice: string }[]>;
  candles(input: { exchange: string; symbol: string; timeframe: '1d'; limit: number; endTime: number }): Promise<{ candles: { openTime: number; close: string }[] }>;
};

/** Matches the market module's per-request ticker limit. */
const TICKERS_PER_REQUEST = 100;

export function marketPriceSource(market: Market, exchange = 'BINANCE', currency = 'USDT'): PriceSource {
  return {
    currency,
    async listed(symbols) {
      const checks = await Promise.all(symbols.map(async s => [s, await market.isActiveInstrument(exchange, s)] as const));
      return new Set(checks.filter(([, ok]) => ok).map(([s]) => s));
    },
    async lastPrices(symbols) {
      const prices = new Map<string, number>();
      for (let i = 0; i < symbols.length; i += TICKERS_PER_REQUEST) {
        for (const t of await market.tickersFor(exchange, symbols.slice(i, i + TICKERS_PER_REQUEST))) {
          const value = Number(t.lastPrice);
          if (Number.isFinite(value) && value > 0) prices.set(t.symbol, value);
        }
      }
      return prices;
    },
    async dailyClose(symbol, day) {
      const start = Date.parse(`${day}T00:00:00Z`);
      const { candles } = await market.candles({ exchange, symbol, timeframe: '1d', limit: 1, endTime: start + 86_399_999 });
      // Before a pair was listed the exchange returns nothing, or an earlier candle: neither is that day.
      const candle = candles.at(-1);
      const close = candle && candle.openTime === start ? Number(candle.close) : NaN;
      return Number.isFinite(close) && close > 0 ? close : null;
    },
  };
}
