// Live market data over the backend's WebSocket (`/api/v1/market/stream`), browser-only port of
// app/src/lib/socket.ts. The browser sends the session cookie on the upgrade request itself.
// Events: connect / disconnect, quote ({ exchange, symbol, ticker }),
// candle ({ exchange, symbol, timeframe, isClosed, candle }), market-status ({ exchange, status }).
import type { Candle, Ticker } from "../types";
import {
  candleFromBackend,
  tickerFromBackend,
  type BackendCandle,
  type BackendTicker,
} from "./market";
import { QuoteSubscriptions } from "./quoteSubscriptions";

type Listener = (...args: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
type ServerMessage =
  | { type: "ticker"; topic: string; data: BackendTicker }
  | { type: "candle"; topic: string; data: BackendCandle }
  | { type: "status"; exchange: string; status: string }
  | { type: "subscribed"; topics: string[]; rejected: { topic: string; reason: string }[] }
  | { type: "error"; code: string; message: string }
  | { type: "pong" | "unsubscribed" };

export interface QuoteEvent {
  exchange: string;
  symbol: string;
  ticker: Ticker;
}
export interface CandleEvent {
  exchange: string;
  symbol: string;
  timeframe: string;
  isClosed: boolean;
  candle: Candle;
}

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

export class MarketSocket {
  connected = false;
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private topics = new Set<string>();
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly url: string) {}

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    this.ensureOpen();
  }

  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
  }

  /** `subscribe`/`unsubscribe` take `EXCHANGE:SYMBOL`; the `-candles` variants `EXCHANGE:SYMBOL:TIMEFRAME`. */
  emit(event: string, keys: string[]) {
    const kind = event.endsWith("-candles") ? "candles" : "ticker";
    const topics = keys.map((key) => `${kind}:${key}`);
    if (event.startsWith("subscribe")) topics.forEach((t) => this.topics.add(t));
    else topics.forEach((t) => this.topics.delete(t));
    this.send({ op: event.startsWith("subscribe") ? "subscribe" : "unsubscribe", topics });
  }

  /** Closes for good, e.g. on sign-out. */
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
  }

  private fire(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }

  private send(message: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private ensureOpen() {
    if (this.ws || this.timer || this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.connected = true;
      // Topics that consumers still hold are re-sent by QuoteSubscriptions on 'connect'.
      this.topics.clear();
      this.ping = setInterval(() => this.send({ op: "ping" }), PING_MS);
      this.fire("connect");
    };
    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "ticker") {
        const quote: QuoteEvent = {
          exchange: message.data.exchange,
          symbol: message.data.symbol,
          ticker: tickerFromBackend(message.data),
        };
        this.fire("quote", quote);
      } else if (message.type === "candle") {
        const [, exchange, symbol, timeframe] = message.topic.split(":");
        const candle: CandleEvent = {
          exchange, symbol, timeframe,
          isClosed: message.data.isClosed,
          candle: candleFromBackend(message.data),
        };
        this.fire("candle", candle);
      } else if (message.type === "status") {
        this.fire("market-status", { exchange: message.exchange, status: message.status });
      } else if (message.type === "subscribed" && message.rejected.length) {
        console.warn("market stream rejected topics", message.rejected);
      } else if (message.type === "error") {
        console.warn("market stream error", message.code, message.message);
      }
    };
    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (wasConnected) this.fire("disconnect");
      if (this.stopped) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts++) * (0.75 + Math.random() * 0.5);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.ensureOpen();
      }, delay);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }
}

let socket: MarketSocket | null = null;
let quotes: QuoteSubscriptions | null = null;
let candles: QuoteSubscriptions | null = null;

function streamUrl() {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/api/v1/market/stream`;
}

export function getSocket(): MarketSocket {
  socket ??= new MarketSocket(streamUrl());
  return socket;
}

/** `keys` are `EXCHANGE:SYMBOL`. Returns an unsubscribe function. */
export function subscribeQuotes(keys: string[], onQuote: (quote: QuoteEvent) => void) {
  if (!keys.length) return () => {};
  // The backend allows 50 topics per connection; leave room for chart candles.
  quotes ??= new QuoteSubscriptions(getSocket(), false, 45);
  return quotes.subscribe(keys, onQuote);
}

/** `keys` are `EXCHANGE:SYMBOL:TIMEFRAME`. Returns an unsubscribe function. */
export function subscribeCandles(keys: string[], onCandle: (event: CandleEvent) => void) {
  if (!keys.length) return () => {};
  candles ??= new QuoteSubscriptions(getSocket(), true);
  return candles.subscribe(keys, onCandle);
}

/** Drops the connection and its subscriptions; the next subscribe opens a fresh one. */
export function closeMarketSocket() {
  socket?.stop();
  socket = null;
  quotes = null;
  candles = null;
}
