import type { MarketDataProvider, Quote } from './types';

export async function availableQuotes(provider: MarketDataProvider, symbols: { symbol: string; exchange?: string }[]): Promise<Quote[]> {
  const results = await Promise.allSettled(symbols.map((s) => provider.quote(s.symbol, s.exchange)));
  const quotes = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []);
  // Unsupported instruments must not hide valid quotes in the same watchlist.
  if (!quotes.length) {
    const failure = results.find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  return quotes;
}
