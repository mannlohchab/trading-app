// Backend market data (`/api/v1/market`, Binance spot) in the shapes the screens render.
// Prices arrive as exact decimal strings; they become numbers here for display only.
import type { ChartCandle } from '@/components/charts/chartHtml';
import type { QuoteLike } from '@/components/markets/InstrumentRow';
import { api } from './api';
import { DEMO_MODE } from './demoMode';
import { marketAssets } from './marketAssets';
import type { HistoryResponse } from './marketHistory';

export const EXCHANGE = 'BINANCE';

export type BackendTicker = {
  exchange: string; symbol: string; lastPrice: string; priceChange: string; priceChangePercent: string;
  openPrice: string; highPrice: string; lowPrice: string; volume: string; quoteVolume: string;
  bidPrice: string | null; askPrice: string | null; time: number;
};
export type BackendCandle = {
  openTime: number; closeTime: number; open: string; high: string; low: string; close: string; volume: string; isClosed: boolean;
};
export type BackendInstrument = {
  exchange: string; symbol: string; baseAsset: string; quoteAsset: string; pricePrecision: number | null;
  quantityPrecision: number | null; tickSize: string | null; stepSize: string | null; isActive: boolean;
  metadata: Record<string, unknown>;
};

export type DetailQuote = QuoteLike & { open?: number; high?: number; low?: number; close?: number; volume?: number; bid?: number; ask?: number };

const NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana', XRP: 'XRP', DOGE: 'Dogecoin', ADA: 'Cardano', TRX: 'TRON',
  AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', BCH: 'Bitcoin Cash', SHIB: 'Shiba Inu',
  TON: 'Toncoin', SUI: 'Sui', NEAR: 'NEAR Protocol', APT: 'Aptos', UNI: 'Uniswap', ATOM: 'Cosmos', XLM: 'Stellar',
  PEPE: 'Pepe', USDC: 'USD Coin', FDUSD: 'First Digital USD', ARB: 'Arbitrum', OP: 'Optimism', FIL: 'Filecoin',
  ETC: 'Ethereum Classic', HBAR: 'Hedera', ICP: 'Internet Computer', AAVE: 'Aave', TAO: 'Bittensor', WLD: 'Worldcoin',
};

/** Human name for a pair, e.g. BTCUSDT → "Bitcoin". Falls back to "BASE / QUOTE". */
export function pairName(symbol: string, base?: string, quote?: string) {
  const [b, q] = base && quote ? [base, quote] : marketAssets(symbol, EXCHANGE) ?? [symbol, ''];
  return NAMES[b] ?? (q ? `${b} / ${q}` : b);
}

/** Decimal places worth showing for a price string ("74569.26000000" → 2). */
export function decimalsOf(price: string | null | undefined) {
  const fraction = (price ?? '').split('.')[1]?.replace(/0+$/, '') ?? '';
  return Math.max(2, Math.min(8, fraction.length));
}

const num = (value: string | null | undefined) => (value == null ? undefined : Number(value));

export function tickerToQuote(t: BackendTicker): DetailQuote {
  const assets = marketAssets(t.symbol, t.exchange);
  return {
    symbol: t.symbol, exchange: t.exchange, name: pairName(t.symbol), currency: assets?.[1] ?? 'USDT',
    assetClass: 'crypto', pricePrecision: decimalsOf(t.lastPrice),
    ltp: Number(t.lastPrice), change: Number(t.priceChange), changePercent: Number(t.priceChangePercent),
    open: num(t.openPrice), high: num(t.highPrice), low: num(t.lowPrice), close: num(t.openPrice), volume: num(t.volume),
    bid: num(t.bidPrice), ask: num(t.askPrice), source: 'binance', asOf: t.time / 1000,
  };
}

export const candleToChart = (c: BackendCandle): ChartCandle => ({
  time: c.openTime / 1000, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
});

type ListSort = 'volume' | 'gainers' | 'losers';
export type ExploreData = { crypto: QuoteLike[]; forex: QuoteLike[]; constituents: QuoteLike[]; isDemo: boolean };

/** Stablecoins and fiat tokens priced near 1 USDT: noise in discovery lists, still searchable and tradable. */
const PEGGED = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'RLUSD', 'BFUSD', 'XUSD', 'EUR', 'EURI', 'AEUR', 'PAXG', 'XAUT']);
export const isPegged = (symbol: string) => PEGGED.has(marketAssets(symbol, EXCHANGE)?.[0] ?? '');

/** Most active USDT pairs (or top gainers/losers) with 24h statistics, without stablecoin pairs. */
export async function fetchTickerList(sort: ListSort = 'volume', limit = 30, signal?: AbortSignal): Promise<ExploreData> {
  if (DEMO_MODE) return api<ExploreData>('/api/market/explore', { signal });
  const { tickers } = await api<{ tickers: BackendTicker[] }>(`/api/v1/market/tickers?quote=USDT&sort=${sort}&limit=${limit + 15}`, { signal });
  const crypto = tickers.filter(t => !isPegged(t.symbol)).slice(0, limit).map(tickerToQuote);
  return { crypto, forex: [], constituents: [], isDemo: false };
}

export async function fetchQuote(symbol: string, signal?: AbortSignal): Promise<{ quote: DetailQuote; isDemo: boolean }> {
  if (DEMO_MODE) return api(`/api/market/quote/${encodeURIComponent(symbol)}?exchange=${EXCHANGE}`, { signal });
  const { tickers } = await api<{ tickers: BackendTicker[] }>(`/api/v1/market/tickers?symbols=${encodeURIComponent(symbol)}`, { signal });
  if (!tickers[0]) throw new Error(`${symbol} has no price right now.`);
  return { quote: tickerToQuote(tickers[0]), isDemo: false };
}

export type CandlesResponse = { candles: ChartCandle[]; source?: 'binance' | 'demo'; pricePrecision?: number; currency?: string };

/** OHLCV, oldest first, with times in seconds as the charts expect. */
export async function fetchCandles(symbol: string, timeframe: string, limit = 500, signal?: AbortSignal): Promise<CandlesResponse> {
  if (DEMO_MODE) return api(`/api/market/candles/${encodeURIComponent(symbol)}?exchange=${EXCHANGE}&timeframe=${timeframe}`, { signal });
  const res = await api<{ candles: BackendCandle[] }>(`/api/v1/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`, { signal });
  const candles = res.candles.map(candleToChart);
  return { candles, source: 'binance', currency: marketAssets(symbol, EXCHANGE)?.[1] ?? 'USDT',
    pricePrecision: decimalsOf(res.candles.at(-1)?.close) };
}

/** Closing prices for sparklines and previews. */
export async function fetchHistory(symbol: string, timeframe: string, limit = 300, signal?: AbortSignal): Promise<HistoryResponse> {
  if (DEMO_MODE) return api(`/api/market/candles/${encodeURIComponent(symbol)}?exchange=${EXCHANGE}&timeframe=${timeframe}&liveOnly=true`, { signal });
  const { candles } = await fetchCandles(symbol, timeframe, limit, signal);
  return { candles: candles.map(c => ({ time: c.time, close: c.close, source: 'binance' as const })), isDemo: false, source: 'binance' };
}

export type SearchResult = { symbol: string; exchange: string; name: string };

/** Search the instrument catalog (USDT pairs). */
export async function searchPairs(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (DEMO_MODE) return (await api<{ results: SearchResult[] }>(`/api/market/search?q=${encodeURIComponent(query)}`, { signal })).results;
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { symbols } = await api<{ symbols: BackendInstrument[] }>(
    `/api/v1/market/symbols?quote=USDT&limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal });
  return symbols.map(s => ({ symbol: s.symbol, exchange: s.exchange, name: pairName(s.symbol, s.baseAsset, s.quoteAsset) }));
}

/** Trading rules (tick, lot step, minimum notional) for one pair. */
export async function fetchInstrument(symbol: string, signal?: AbortSignal): Promise<BackendInstrument | null> {
  const { symbols } = await api<{ symbols: BackendInstrument[] }>(`/api/v1/market/symbols?q=${encodeURIComponent(symbol)}&limit=20`, { signal });
  return symbols.find(s => s.symbol === symbol) ?? null;
}
