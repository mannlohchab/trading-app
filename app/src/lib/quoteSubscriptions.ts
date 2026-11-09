type SocketLike = { connected?: boolean; emit: (event: string, ...args: any[]) => unknown; on: (event: string, fn: (...args: any[]) => void) => unknown; off: (event: string, fn: (...args: any[]) => void) => unknown };
type Consumer = { keys: Set<string>; callback: (data: any) => void; onLimit?: (count: number) => void };
/** One subscription per key, regardless of how many mounted screens consume it. */
export class QuoteSubscriptions {
  private socket: SocketLike;
  private consumers = new Set<Consumer>();
  private counts = new Map<string, number>();
  private active = new Set<string>();
  private event: string;
  private subscribeEvent: string;
  private unsubscribeEvent: string;
  private limit: number;
  constructor(socket: SocketLike, candle = false, limit = 50) {
    this.socket = socket; this.limit = limit; this.event = candle ? 'candle' : 'quote';
    this.subscribeEvent = candle ? 'subscribe-candles' : 'subscribe'; this.unsubscribeEvent = candle ? 'unsubscribe-candles' : 'unsubscribe';
  }
  private send(event: string, keys: string[]) {
    if (keys.length && this.socket.connected !== false) this.socket.emit(event, keys);
  }
  private reconnect = () => { if (this.active.size) this.send(this.subscribeEvent, [...this.active]); };
  private receive = (data: any) => {
    const key = `${data?.exchange}:${data?.symbol}${this.event === 'candle' ? ':' + data?.timeframe : ''}`;
    for (const c of this.consumers) if (c.keys.has(key)) c.callback(data);
  };
  private reconcile() {
    const next = new Set([...this.counts.keys()].slice(0,this.limit));
    const removed = [...this.active].filter(k => !next.has(k));
    const added = [...next].filter(k => !this.active.has(k));
    if (removed.length) this.send(this.unsubscribeEvent, removed);
    if (added.length) this.send(this.subscribeEvent, added);
    this.active = next;
    for (const c of this.consumers) c.onLimit?.([...c.keys].filter(k => !next.has(k)).length);
  }
  subscribe(keys: string[], callback: (data: any) => void, onLimit?: (count: number) => void) {
    if (!this.consumers.size) { this.socket.on('connect', this.reconnect); this.socket.on(this.event, this.receive); }
    const consumer = {keys: new Set(keys.filter(k => k.includes(':'))), callback, onLimit};
    this.consumers.add(consumer);
    for (const key of consumer.keys) this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.reconcile();
    let active = true;
    return () => {
      if (!active) return; active = false; this.consumers.delete(consumer);
      for (const key of consumer.keys) { const count = (this.counts.get(key) ?? 1) - 1;
        if (count) this.counts.set(key, count); else this.counts.delete(key); }
      this.reconcile();
      if (!this.consumers.size) { this.socket.off('connect', this.reconnect); this.socket.off(this.event, this.receive); }
    };
  }
}
