import { demoMarketData, marketStatus } from './demoMarketData';
import type { MarketDataProvider, MarketOverview, Quote } from './types';

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

export async function marketOverview(provider: MarketDataProvider): Promise<MarketOverview> {
  const indices = await provider.quotes([
    { symbol: 'NIFTY' }, { symbol: 'BANKNIFTY' }, { symbol: 'SENSEX', exchange: 'BSE' },
    { symbol: 'FINNIFTY' }, { symbol: 'INDIAVIX' },
  ]);
  const major = indices.filter((q) => ['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(q.symbol));
  const avg = major.reduce((sum, q) => sum + q.changePercent, 0) / (major.length || 1);
  const vix = indices.find((q) => q.symbol === 'INDIAVIX')?.ltp;
  return { ...marketStatus(), indices, isDemo: false,
    sentiment: avg > 0.3 ? 'Bullish' : avg < -0.3 ? 'Bearish' : 'Neutral',
    volatilityLabel: vix == null ? 'Unavailable' : vix > 18 ? 'Elevated' : vix > 14 ? 'Moderate' : 'Low',
    news: [], events: [],
  };
}

export async function marketMovers(provider: MarketDataProvider) {
  const stocks = demoMarketData.listAll().filter((i) => i.exchange === 'NSE' && !i.segment);
  const quotes = await provider.quotes(stocks);
  const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
  return { gainers: sorted.filter((q) => q.changePercent > 0).slice(0, 5),
    losers: sorted.filter((q) => q.changePercent < 0).reverse().slice(0, 5),
    active: [...quotes].sort((a, b) => b.volume - a.volume).slice(0, 5) };
}
