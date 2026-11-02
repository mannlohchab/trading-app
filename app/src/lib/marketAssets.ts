const QUOTE_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH'];

/** Splits a market symbol into base/quote assets: EUR/USD → [EUR, USD], BTCUSDT → [BTC, USDT]. */
export function marketAssets(symbol: string, exchange?: string): [string, string] | null {
  const upper = symbol.toUpperCase();
  if (exchange?.toUpperCase() === 'FOREX' || upper.includes('/')) {
    const [base, quote] = upper.replace(/^([A-Z]{3})([A-Z]{3})$/, '$1/$2').split('/');
    return base && quote ? [base, quote] : null;
  }
  const quote = QUOTE_ASSETS.find(q => upper.endsWith(q) && upper.length > q.length);
  return quote ? [upper.slice(0, -quote.length), quote] : null;
}
