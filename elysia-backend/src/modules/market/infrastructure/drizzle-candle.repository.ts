import { and, desc, eq, lte } from 'drizzle-orm';
import { marketCandles } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { CandleRepository } from '../application/ports';
import type { Timeframe } from '../domain/market-options';
import { normalizeDecimal } from '../domain/rules';
import type { Candle } from '../domain/types';

const CHUNK = 500;
const dec = (v: string | null) => (v === null ? null : normalizeDecimal(v));

export class DrizzleCandleRepository implements CandleRepository {
  constructor(private readonly db: AppDatabase) {}

  async saveClosed(symbolId: string, timeframe: Timeframe, candles: Candle[]) {
    const closed = candles.filter(c => c.isClosed);
    for (let i = 0; i < closed.length; i += CHUNK) {
      await this.db
        .insert(marketCandles)
        .values(closed.slice(i, i + CHUNK).map(c => ({
          symbolId, timeframe,
          openTime: c.openTime, closeTime: c.closeTime,
          open: c.open, high: c.high, low: c.low, close: c.close,
          volume: c.volume, quoteVolume: c.quoteVolume, tradesCount: c.trades,
          isClosed: true,
        })))
        .onConflictDoNothing({ target: [marketCandles.symbolId, marketCandles.timeframe, marketCandles.openTime] });
    }
  }

  async latest(symbolId: string, timeframe: Timeframe, { limit, endTime }: { limit: number; endTime?: number }) {
    const rows = await this.db
      .select()
      .from(marketCandles)
      .where(and(
        eq(marketCandles.symbolId, symbolId),
        eq(marketCandles.timeframe, timeframe),
        endTime !== undefined ? lte(marketCandles.openTime, endTime) : undefined,
      ))
      .orderBy(desc(marketCandles.openTime))
      .limit(limit);
    return rows.reverse().map(r => ({
      openTime: r.openTime, closeTime: r.closeTime,
      open: dec(r.open)!, high: dec(r.high)!, low: dec(r.low)!, close: dec(r.close)!,
      volume: dec(r.volume)!, quoteVolume: dec(r.quoteVolume), trades: r.tradesCount, isClosed: r.isClosed,
    }));
  }
}
