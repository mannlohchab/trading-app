import type { FeedEvent, FeedStatus, LiveFeed } from '../../application/ports';
import { isTimeframe } from '../../domain/market-options';
import type { Topic } from '../../domain/types';
import { BINANCE, candleFromStream, tickerFromStream, type BinanceWsKline, type BinanceWsTicker } from './binance-mappers';

/** The subset of the WebSocket API the feed uses (lets tests supply a fake). */
export type FeedSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
};

type Options = {
  url?: string;
  createSocket?: (url: string) => FeedSocket;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Batch subscription changes for this long (Binance allows 5 control messages per second). */
  debounceMs?: number;
  /** Reconnect if nothing arrives for this long while subscribed. */
  silenceMs?: number;
};

const OPEN = 1;
const PARAMS_PER_MESSAGE = 200;
const MAX_STREAMS = 1024; // Binance's per-connection limit

export const streamName = (t: Topic) =>
  t.kind === 'ticker' ? `${t.symbol.toLowerCase()}@ticker` : `${t.symbol.toLowerCase()}@kline_${t.timeframe}`;

/**
 * One combined-stream connection to Binance. Subscriptions change in place via SUBSCRIBE/UNSUBSCRIBE
 * (no reconnect for everyone when one client adds a symbol).
 */
export class BinanceLiveFeed implements LiveFeed {
  readonly exchange = BINANCE;
  private wanted = new Set<string>();
  private active = new Set<string>();
  private socket: FeedSocket | null = null;
  private eventListeners: ((e: FeedEvent) => void)[] = [];
  private statusListeners: ((s: FeedStatus) => void)[] = [];
  private currentStatus: FeedStatus = 'idle';
  private syncTimer: unknown;
  private reconnectTimer: unknown;
  private healthTimer: unknown;
  private attempts = 0;
  private lastMessageAt = 0;
  private requestId = 0;
  private stopped = false;

  constructor(private readonly options: Options = {}) {}

  get status() { return this.currentStatus; }
  onEvent(listener: (e: FeedEvent) => void) { this.eventListeners.push(listener); }
  onStatus(listener: (s: FeedStatus) => void) { this.statusListeners.push(listener); }

  setTopics(topics: Topic[]) {
    this.wanted = new Set(topics.filter(t => t.exchange === BINANCE).map(streamName).slice(0, MAX_STREAMS));
    this.clear(this.syncTimer);
    this.syncTimer = this.timer(() => this.sync(), this.options.debounceMs ?? 250);
  }

  stop() {
    this.stopped = true;
    this.wanted.clear();
    [this.syncTimer, this.reconnectTimer, this.healthTimer].forEach(t => this.clear(t));
    this.closeSocket();
    this.setStatus('idle');
  }

  private sync() {
    if (this.stopped) return;
    if (!this.wanted.size) {
      this.clear(this.reconnectTimer);
      this.closeSocket();
      this.setStatus('idle');
      return;
    }
    if (!this.socket) return this.connect();
    if (this.socket.readyState !== OPEN) return; // onopen will sync
    const add = [...this.wanted].filter(s => !this.active.has(s));
    const remove = [...this.active].filter(s => !this.wanted.has(s));
    this.control('UNSUBSCRIBE', remove);
    this.control('SUBSCRIBE', add);
  }

  private control(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', streams: string[]) {
    for (let i = 0; i < streams.length; i += PARAMS_PER_MESSAGE) {
      const params = streams.slice(i, i + PARAMS_PER_MESSAGE);
      this.socket!.send(JSON.stringify({ method, params, id: ++this.requestId }));
      for (const s of params) method === 'SUBSCRIBE' ? this.active.add(s) : this.active.delete(s);
    }
  }

  private connect() {
    this.setStatus(this.attempts ? 'reconnecting' : 'connecting');
    let socket: FeedSocket;
    try {
      const url = this.options.url ?? 'wss://data-stream.binance.vision/stream';
      socket = this.options.createSocket ? this.options.createSocket(url) : (new WebSocket(url) as unknown as FeedSocket);
    } catch {
      return this.scheduleReconnect();
    }
    this.socket = socket;
    this.active.clear();
    this.lastMessageAt = this.now();
    socket.onopen = () => { if (this.socket === socket) this.sync(); };
    socket.onclose = () => { if (this.socket === socket) this.scheduleReconnect(); };
    socket.onerror = () => { if (this.socket === socket) this.scheduleReconnect(); };
    socket.onmessage = event => { if (this.socket === socket) this.onMessage(event.data); };
    this.scheduleHealthCheck(socket);
  }

  private onMessage(raw: unknown) {
    let body: any;
    try { body = JSON.parse(String(raw)); } catch { return; }
    if (body?.error) return; // a rejected SUBSCRIBE; the stream simply won't arrive
    const data = body?.data;
    if (!data || typeof data !== 'object') return; // control acks: { result: null, id }
    this.lastMessageAt = this.now();
    try {
      if (data.e === '24hrTicker') {
        const ticker = tickerFromStream(data as BinanceWsTicker);
        this.emit({ type: 'ticker', topic: { kind: 'ticker', exchange: BINANCE, symbol: ticker.symbol }, ticker });
      } else if (data.e === 'kline' && isTimeframe(data.k?.i)) {
        const k = data as BinanceWsKline;
        this.emit({ type: 'candle', topic: { kind: 'candles', exchange: BINANCE, symbol: k.s, timeframe: data.k.i }, candle: candleFromStream(k) });
      } else return;
    } catch {
      return; // malformed event: ignore rather than forward bad numbers
    }
    this.attempts = 0;
    this.setStatus('live');
  }

  private emit(event: FeedEvent) {
    for (const listener of this.eventListeners) listener(event);
  }

  private scheduleReconnect() {
    this.closeSocket();
    if (this.stopped || !this.wanted.size) return this.setStatus('idle');
    this.setStatus('reconnecting');
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.floor(Math.random() * 500);
    this.clear(this.reconnectTimer);
    this.reconnectTimer = this.timer(() => this.connect(), delay);
  }

  private scheduleHealthCheck(socket: FeedSocket) {
    this.clear(this.healthTimer);
    this.healthTimer = this.timer(() => {
      if (this.socket !== socket) return;
      if (this.active.size && this.now() - this.lastMessageAt > (this.options.silenceMs ?? 60_000)) return this.scheduleReconnect();
      this.scheduleHealthCheck(socket);
    }, 10_000);
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.active.clear();
    this.clear(this.healthTimer);
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = null;
      socket.onmessage = null;
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  private setStatus(status: FeedStatus) {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private now() { return (this.options.now ?? Date.now)(); }
  private timer(fn: () => void, ms: number) { return (this.options.setTimer ?? setTimeout)(fn, ms); }
  private clear(id: unknown) { if (id !== undefined) (this.options.clearTimer ?? ((t: unknown) => clearTimeout(t as Timer)))(id); }
}
