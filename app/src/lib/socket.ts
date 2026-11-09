// Live market data over the backend's WebSocket (`/api/v1/market/stream`).
// `MarketSocket` speaks the backend protocol and re-emits app events, so hooks keep a small surface:
//   connect / disconnect, quote (QuoteLike), candle ({ exchange, symbol, timeframe, eventTime, candle }),
//   market-status ({ exchange, status }).
import { Platform } from 'react-native';
import { authHeaders } from './authClient';
import { WS_URL } from './config';
import { DEMO_MODE } from './demoMode';
import { candleToChart, tickerToQuote, type BackendCandle, type BackendTicker } from './marketData';
import { QuoteSubscriptions } from './quoteSubscriptions';

type Listener = (...args: any[]) => void;
type ServerMessage =
  | { type: 'ticker'; topic: string; data: BackendTicker }
  | { type: 'candle'; topic: string; data: BackendCandle }
  | { type: 'status'; exchange: string; status: string }
  | { type: 'subscribed'; topics: string[]; rejected: { topic: string; reason: string }[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' | 'unsubscribed' };

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
  private opening = false;

  constructor(private readonly url: string) {}

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    this.ensureOpen();
  }

  off(event: string, fn: Listener) { this.listeners.get(event)?.delete(fn); }

  /** `subscribe`/`unsubscribe` take `EXCHANGE:SYMBOL`; the `-candles` variants take `EXCHANGE:SYMBOL:TIMEFRAME`. */
  emit(event: string, keys: string[]) {
    const kind = event.endsWith('-candles') ? 'candles' : 'ticker';
    const topics = keys.map(key => `${kind}:${key}`);
    if (event.startsWith('subscribe')) topics.forEach(t => this.topics.add(t));
    else topics.forEach(t => this.topics.delete(t));
    this.send({ op: event.startsWith('subscribe') ? 'subscribe' : 'unsubscribe', topics });
  }

  /** Reconnects with fresh credentials, e.g. after signing in. */
  restart() {
    this.ws?.close();
    this.attempts = 0;
  }

  private fire(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }

  private send(message: unknown) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  private ensureOpen() {
    if (this.ws || this.timer || this.stopped || this.opening) return;
    this.opening = true;
    void this.open().finally(() => { this.opening = false; });
  }

  private async open() {
    const { headers } = await authHeaders().catch(() => ({ headers: {} as Record<string, string> }));
    // React Native accepts headers (the session cookie) as a third argument; browsers send cookies themselves.
    const WS = WebSocket as unknown as new (url: string, protocols?: string[] | null, options?: { headers: Record<string, string> }) => WebSocket;
    const ws = Platform.OS === 'web' ? new WebSocket(this.url) : new WS(this.url, null, { headers });
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.connected = true;
      // Topics that consumers still hold are re-sent by QuoteSubscriptions on 'connect'.
      this.topics.clear();
      this.ping = setInterval(() => this.send({ op: 'ping' }), PING_MS);
      this.fire('connect');
    };
    ws.onmessage = event => {
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === 'ticker') this.fire('quote', tickerToQuote(message.data));
      else if (message.type === 'candle') {
        const [, exchange, symbol, timeframe] = message.topic.split(':');
        this.fire('candle', { exchange, symbol, timeframe, eventTime: Date.now(), isClosed: message.data.isClosed, candle: candleToChart(message.data) });
      } else if (message.type === 'status') this.fire('market-status', { exchange: message.exchange, status: message.status });
    };
    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (wasConnected) this.fire('disconnect');
      if (this.stopped) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts++) * (0.75 + Math.random() * 0.5);
      this.timer = setTimeout(() => { this.timer = null; this.ensureOpen(); }, delay);
    };
    ws.onerror = () => { /* onclose follows */ };
  }
}

let socket: MarketSocket | null = null;
let quotes: QuoteSubscriptions | null = null;
let candles: QuoteSubscriptions | null = null;

export function getSocket(): MarketSocket {
  socket ??= new MarketSocket(`${WS_URL}/api/v1/market/stream`);
  return socket;
}
export function subscribeQuotes(keys: string[], onQuote: (quote: any) => void, onLimit?: (count: number) => void) {
  if (DEMO_MODE || !keys.length) return () => {};
  // The backend allows 50 topics per connection; leave room for chart candles.
  quotes ??= new QuoteSubscriptions(getSocket(), false, 45);
  return quotes.subscribe(keys, onQuote, onLimit);
}
export function subscribeCandles(keys: string[], onCandle: (event: any) => void) {
  if (DEMO_MODE || !keys.length) return () => {};
  candles ??= new QuoteSubscriptions(getSocket(), true);
  return candles.subscribe(keys, onCandle);
}
