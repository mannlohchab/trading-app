import { isoDay, pricingSymbol, validateHoldings, valuePortfolio, type HoldingInput, type PricedLot } from '../domain/holdings';
import type { Clock, HoldingsRepository, PriceSource } from './ports';

/** Daily-close lookups run a few at a time so a long table doesn't burst the exchange. */
const CLOSE_LOOKUP_CONCURRENCY = 5;

export class PortfolioService {
  constructor(private readonly deps: { repository: HoldingsRepository; prices: PriceSource; clock: Clock; log?: (message: string, error?: unknown) => void }) {}

  list(userId: string) {
    return this.deps.repository.list(userId);
  }

  async replace(userId: string, rows: HoldingInput[]) {
    const checked = validateHoldings(rows, isoDay(this.deps.clock.now()));
    if (!checked.ok) return checked;
    await this.deps.repository.replace(userId, checked.holdings);
    return { ok: true as const, ...(await this.deps.repository.list(userId)) };
  }

  /**
   * Values the user's holdings at current prices. Assets that aren't listed, or whose prices can't
   * be fetched right now, are still returned, just without value or P/L.
   */
  async valuation(userId: string) {
    const { holdings, updatedAt } = await this.deps.repository.list(userId);
    const { prices } = this.deps;
    const quote = prices.currency;
    const candidates = new Map(holdings.map(h => [h.asset, h.asset === quote ? null : pricingSymbol(h.asset, quote)]));
    const wanted = [...new Set([...candidates.values()].filter((s): s is string => !!s))];

    const listed = wanted.length ? await this.safely(() => prices.listed(wanted), new Set<string>()) : new Set<string>();
    const symbols = wanted.filter(s => listed.has(s));
    const last = symbols.length ? await this.safely(() => prices.lastPrices(symbols), new Map<string, number>()) : new Map<string, number>();

    const closes = new Map<string, number | null>();
    const needed = [...new Set(holdings
      .filter(h => h.buyPrice === null && symbols.includes(candidates.get(h.asset) ?? ''))
      .map(h => `${candidates.get(h.asset)}@${h.boughtOn}`))];
    for (let i = 0; i < needed.length; i += CLOSE_LOOKUP_CONCURRENCY) {
      await Promise.all(needed.slice(i, i + CLOSE_LOOKUP_CONCURRENCY).map(async key => {
        const [symbol, day] = key.split('@') as [string, string];
        closes.set(key, await this.safely(() => prices.dailyClose(symbol, day), null));
      }));
    }

    const lots: PricedLot[] = holdings.map(h => {
      // The quote currency itself (e.g. USDT held as cash) is worth exactly 1.
      if (h.asset === quote) return { ...h, symbol: quote, currentPrice: 1, closeOnBuyDate: 1 };
      const symbol = candidates.get(h.asset);
      if (!symbol || !listed.has(symbol)) return { ...h, symbol: null, currentPrice: null, closeOnBuyDate: null };
      return { ...h, symbol, currentPrice: last.get(symbol) ?? null, closeOnBuyDate: closes.get(`${symbol}@${h.boughtOn}`) ?? null };
    });
    return { ...valuePortfolio(lots, this.deps.clock.now(), quote), updatedAt };
  }

  private async safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await load();
    } catch (error) {
      this.deps.log?.('Price lookup failed', error);
      return fallback;
    }
  }
}
