// Ported from app/src/lib/marketAssets.ts.
const QUOTE_ASSETS = ["USDT", "USDC", "BTC", "ETH"];

/** Splits a market symbol into base/quote assets: BTCUSDT → [BTC, USDT]. */
export function marketAssets(symbol: string): [string, string] | null {
  const upper = symbol.toUpperCase();
  const quote = QUOTE_ASSETS.find((q) => upper.endsWith(q) && upper.length > q.length);
  return quote ? [upper.slice(0, -quote.length), quote] : null;
}

export function baseAsset(symbol: string): string {
  return marketAssets(symbol)?.[0] ?? symbol;
}

export function quoteAsset(symbol: string): string {
  return marketAssets(symbol)?.[1] ?? "USDT";
}
