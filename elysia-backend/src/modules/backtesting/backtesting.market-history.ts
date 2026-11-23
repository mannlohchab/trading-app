// Makes sure the requested candle history is in Postgres before a backtest reads it. Uses the market
// module's public service, which fetches from Binance and stores every closed candle in
// market_candles; the backtest itself then reads only from Postgres.
import type { MarketDataService } from '../market/application/market-data.service';
import type { Timeframe } from '../market/domain/market-options';

const PAGE = 1000;

export interface CandleHistory {
  /** Fetches and stores closed candles for [start, end) that are not stored yet. */
  ensure(input: { exchange: string; symbol: string; timeframe: Timeframe; start: number; end: number; expected: number; stored: number }): Promise<void>;
}

export class MarketServiceCandleHistory implements CandleHistory {
  constructor(private readonly market: MarketDataService) {}

  async ensure({ exchange, symbol, timeframe, start, end, expected, stored }: Parameters<CandleHistory['ensure']>[0]) {
    if (stored >= expected) return;
    // Page backwards from the end of the range (Binance returns at most 1000 candles per request).
    let endTime = end - 1;
    for (let page = 0; page < Math.ceil(expected / PAGE) + 2; page++) {
      const { candles, source } = await this.market.candles({ exchange, symbol, timeframe, limit: PAGE, endTime });
      if (source !== 'exchange' || !candles.length) return; // exchange unavailable or no older data
      const oldest = candles[0]!.openTime;
      if (oldest <= start) return;
      endTime = oldest - 1;
    }
  }
}
