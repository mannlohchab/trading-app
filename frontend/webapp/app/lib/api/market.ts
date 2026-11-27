// Market data from elysia-backend (`/api/v1/market`, Binance spot). Prices arrive as exact decimal
// strings and become numbers here for display only. Shapes ported from app/src/lib/marketData.ts.
import { marketAssets } from "../marketAssets";
import { candlePrecision, decimalsOf } from "../pricePrecision";
import type { Candle, Interval, Ticker } from "../types";
import { apiFetch } from "./client";

export const EXCHANGE = "BINANCE";
export const DEFAULT_SYMBOL = "BTCUSDT";

export interface BackendTicker {
  exchange: string;
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  bidPrice: string | null;
  askPrice: string | null;
  time: number;
}

export interface BackendCandle {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  isClosed: boolean;
}

export interface BackendInstrument {
  exchange: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number | null;
  quantityPrecision: number | null;
  tickSize: string | null;
  stepSize: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

const NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", DOGE: "Dogecoin",
  ADA: "Cardano", TRX: "TRON", AVAX: "Avalanche", LINK: "Chainlink", DOT: "Polkadot",
  LTC: "Litecoin", BCH: "Bitcoin Cash", SHIB: "Shiba Inu", TON: "Toncoin", SUI: "Sui",
  NEAR: "NEAR Protocol", APT: "Aptos", UNI: "Uniswap", ATOM: "Cosmos", XLM: "Stellar",
  PEPE: "Pepe", ARB: "Arbitrum", OP: "Optimism", FIL: "Filecoin", ETC: "Ethereum Classic",
  HBAR: "Hedera", ICP: "Internet Computer", AAVE: "Aave", TAO: "Bittensor", WLD: "Worldcoin",
};

/** Human name for a pair, e.g. BTCUSDT → "Bitcoin". */
export function pairName(symbol: string): string {
  const assets = marketAssets(symbol);
  if (!assets) return symbol;
  return NAMES[assets[0]] ?? `${assets[0]} / ${assets[1]}`;
}

/** Stablecoins and fiat tokens priced near 1 USDT: noise in the market list. */
const PEGGED = new Set([
  "USDC", "FDUSD", "TUSD", "USDP", "DAI", "USDE", "USD1", "RLUSD", "BFUSD", "XUSD",
  "EUR", "EURI", "AEUR", "PAXG", "XAUT",
]);
const isPegged = (symbol: string) => PEGGED.has(marketAssets(symbol)?.[0] ?? "");

const num = (value: string | null | undefined) => (value == null ? 0 : Number(value));

export function tickerFromBackend(t: BackendTicker): Ticker {
  return {
    symbol: t.symbol,
    last: num(t.lastPrice),
    change24h: num(t.priceChange),
    changePct24h: num(t.priceChangePercent),
    open24h: num(t.openPrice),
    high24h: num(t.highPrice),
    low24h: num(t.lowPrice),
    volume24h: num(t.volume),
    quoteVolume24h: num(t.quoteVolume),
    bid: num(t.bidPrice),
    ask: num(t.askPrice),
    time: t.time,
    pricePrecision: decimalsOf(t.lastPrice),
  };
}

export function candleFromBackend(c: BackendCandle): Candle {
  return {
    time: c.openTime,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  };
}

/** Empty ticker shell until the first quote arrives. */
export function emptyTicker(symbol: string = DEFAULT_SYMBOL): Ticker {
  return {
    symbol, last: 0, change24h: 0, changePct24h: 0, open24h: 0, high24h: 0, low24h: 0,
    volume24h: 0, quoteVolume24h: 0, bid: 0, ask: 0, time: 0, pricePrecision: 2,
  };
}

export interface ListedMarket {
  market: string;
  base: string;
  quote: string;
  name: string;
  last: number;
  changePct24h: number;
  /** 24h volume in the quote asset. */
  volume24h: number;
  pricePrecision: number;
}

function toListed(t: BackendTicker): ListedMarket {
  const [base, quote] = marketAssets(t.symbol) ?? [t.symbol, ""];
  return {
    market: t.symbol, base, quote, name: pairName(t.symbol),
    last: num(t.lastPrice), changePct24h: num(t.priceChangePercent),
    volume24h: num(t.quoteVolume), pricePrecision: decimalsOf(t.lastPrice),
  };
}

/** Most active USDT pairs with 24h statistics, without stablecoin pairs. */
export async function fetchMarkets(limit = 60, signal?: AbortSignal): Promise<ListedMarket[]> {
  const { tickers } = await apiFetch<{ tickers: BackendTicker[] }>(
    `/api/v1/market/tickers?quote=USDT&sort=volume&limit=${limit + 15}`,
    { signal },
  );
  return tickers.filter((t) => !isPegged(t.symbol)).slice(0, limit).map(toListed);
}

/** Search the USDT pair catalog, with current prices. */
export async function searchMarkets(query: string, signal?: AbortSignal): Promise<ListedMarket[]> {
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!q) return [];
  const { symbols } = await apiFetch<{ symbols: BackendInstrument[] }>(
    `/api/v1/market/symbols?quote=USDT&limit=30&q=${encodeURIComponent(q)}`,
    { signal },
  );
  const active = symbols.filter((s) => s.isActive).map((s) => s.symbol);
  if (!active.length) return [];
  const { tickers } = await apiFetch<{ tickers: BackendTicker[] }>(
    `/api/v1/market/tickers?symbols=${encodeURIComponent(active.join(","))}`,
    { signal },
  );
  const bySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  return active.flatMap((s) => {
    const t = bySymbol.get(s);
    return t ? [toListed(t)] : [];
  });
}

export async function fetchTicker(symbol: string, signal?: AbortSignal): Promise<Ticker | null> {
  const { tickers } = await apiFetch<{ tickers: BackendTicker[] }>(
    `/api/v1/market/tickers?symbols=${encodeURIComponent(symbol)}`,
    { signal },
  );
  return tickers[0] ? tickerFromBackend(tickers[0]) : null;
}

/** Trading rules (tick, lot step, minimum notional) for one pair. */
export async function fetchInstrument(symbol: string, signal?: AbortSignal): Promise<BackendInstrument | null> {
  const { symbols } = await apiFetch<{ symbols: BackendInstrument[] }>(
    `/api/v1/market/symbols?q=${encodeURIComponent(symbol)}&limit=20`,
    { signal },
  );
  return symbols.find((s) => s.symbol === symbol) ?? null;
}

/** OHLCV, oldest first. `endTime` (unix ms) pages back through history. */
export async function fetchCandles(
  symbol: string,
  interval: Interval,
  limit = 500,
  endTime?: number,
  signal?: AbortSignal,
): Promise<{ candles: Candle[]; pricePrecision: number }> {
  const q = new URLSearchParams({ symbol, timeframe: interval, limit: String(limit) });
  if (endTime !== undefined) q.set("endTime", String(endTime));
  const res = await apiFetch<{ candles: BackendCandle[] }>(`/api/v1/market/candles?${q}`, { signal });
  return { candles: res.candles.map(candleFromBackend), pricePrecision: candlePrecision(res.candles) };
}
