// Fans live market data out to connected clients. One upstream subscription per topic, no matter
// how many clients want it. Framework-free: the WebSocket layer only passes messages in and out.
import { LIMITS, parseTopic, topicKey } from '../domain/rules';
import type { Candle, Ticker, Topic } from '../domain/types';
import type { CandleRepository, FeedEvent, FeedStatus, InstrumentRepository, LiveFeed } from './ports';

export type ServerMessage =
  | { type: 'subscribed'; topics: string[]; rejected: { topic: string; reason: string }[] }
  | { type: 'unsubscribed'; topics: string[] }
  | { type: 'ticker'; topic: string; data: Ticker }
  | { type: 'candle'; topic: string; data: Candle }
  | { type: 'status'; exchange: string; status: FeedStatus }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

type Client = { send: (message: ServerMessage) => void; topics: Set<string> };
type TopicState = { topic: Topic; symbolId: string; clients: Set<number> };

export class LiveMarketHub {
  private readonly feeds: Map<string, LiveFeed>;
  private readonly clients = new Map<number, Client>();
  private readonly topics = new Map<string, TopicState>();
  private nextId = 1;

  constructor(private readonly deps: {
    feeds: LiveFeed[];
    instruments: InstrumentRepository;
    candles: CandleRepository;
    /** Upper bound on distinct upstream topics across all clients. */
    maxTopics?: number;
    log?: (message: string, error?: unknown) => void;
  }) {
    this.feeds = new Map(deps.feeds.map(f => [f.exchange, f]));
    for (const feed of deps.feeds) {
      feed.onEvent(event => this.onFeedEvent(event));
      feed.onStatus(status => this.broadcastStatus(feed.exchange, status));
    }
  }

  connect(send: (message: ServerMessage) => void): number {
    const id = this.nextId++;
    this.clients.set(id, { send, topics: new Set() });
    return id;
  }

  disconnect(clientId: number) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    this.release(clientId, [...client.topics]);
  }

  async subscribe(clientId: number, rawTopics: unknown) {
    const client = this.clients.get(clientId);
    if (!client) return;
    if (!Array.isArray(rawTopics) || rawTopics.length === 0 || rawTopics.length > LIMITS.topicsPerConnection) {
      return client.send({ type: 'error', code: 'INVALID_REQUEST', message: `Send 1 to ${LIMITS.topicsPerConnection} topics.` });
    }
    const accepted: string[] = [];
    const rejected: { topic: string; reason: string }[] = [];
    const parsed: Topic[] = [];
    for (const raw of rawTopics) {
      const topic = typeof raw === 'string' ? parseTopic(raw) : null;
      if (!topic) rejected.push({ topic: String(raw).slice(0, 80), reason: 'INVALID_TOPIC' });
      else if (!this.feeds.has(topic.exchange)) rejected.push({ topic: raw, reason: 'UNKNOWN_EXCHANGE' });
      else parsed.push(topic);
    }

    // Look up symbols per exchange in one query each.
    const byExchange = new Map<string, Topic[]>();
    for (const topic of parsed) byExchange.set(topic.exchange, [...(byExchange.get(topic.exchange) ?? []), topic]);
    const changed = new Set<string>();
    for (const [exchange, topics] of byExchange) {
      const known = await this.deps.instruments.findActive(exchange, [...new Set(topics.map(t => t.symbol))]);
      if (!this.clients.has(clientId)) return; // disconnected while we were looking up
      for (const topic of topics) {
        const key = topicKey(topic);
        const instrument = known.get(topic.symbol);
        if (!instrument) { rejected.push({ topic: key, reason: 'UNKNOWN_SYMBOL' }); continue; }
        if (client.topics.has(key)) { accepted.push(key); continue; }
        if (client.topics.size >= LIMITS.topicsPerConnection) { rejected.push({ topic: key, reason: 'CONNECTION_TOPIC_LIMIT' }); continue; }
        let state = this.topics.get(key);
        if (!state) {
          if (this.topics.size >= (this.deps.maxTopics ?? 1000)) { rejected.push({ topic: key, reason: 'SERVER_TOPIC_LIMIT' }); continue; }
          state = { topic, symbolId: instrument.id, clients: new Set() };
          this.topics.set(key, state);
          changed.add(exchange);
        }
        state.clients.add(clientId);
        client.topics.add(key);
        accepted.push(key);
      }
    }
    for (const exchange of changed) this.syncFeed(exchange);
    client.send({ type: 'subscribed', topics: accepted, rejected });
    for (const exchange of byExchange.keys()) {
      const feed = this.feeds.get(exchange);
      // A feed that was idle connects shortly after (subscriptions are debounced), so say so.
      if (feed) client.send({ type: 'status', exchange, status: feed.status === 'idle' && client.topics.size ? 'connecting' : feed.status });
    }
  }

  unsubscribe(clientId: number, rawTopics: unknown) {
    const client = this.clients.get(clientId);
    if (!client) return;
    const keys = Array.isArray(rawTopics)
      ? rawTopics.flatMap(raw => { const t = typeof raw === 'string' ? parseTopic(raw) : null; return t ? [topicKey(t)] : []; })
      : [];
    const removed = keys.filter(k => client.topics.has(k));
    this.release(clientId, removed);
    client.send({ type: 'unsubscribed', topics: removed });
  }

  ping(clientId: number) {
    this.clients.get(clientId)?.send({ type: 'pong' });
  }

  /** Number of distinct upstream topics (for tests and diagnostics). */
  get activeTopicCount() {
    return this.topics.size;
  }

  stop() {
    for (const feed of this.feeds.values()) feed.stop();
    this.clients.clear();
    this.topics.clear();
  }

  private release(clientId: number, keys: string[]) {
    const changed = new Set<string>();
    const client = this.clients.get(clientId);
    for (const key of keys) {
      client?.topics.delete(key);
      const state = this.topics.get(key);
      if (!state) continue;
      state.clients.delete(clientId);
      if (!state.clients.size) {
        this.topics.delete(key);
        changed.add(state.topic.exchange);
      }
    }
    for (const exchange of changed) this.syncFeed(exchange);
  }

  private syncFeed(exchange: string) {
    const topics = [...this.topics.values()].filter(s => s.topic.exchange === exchange).map(s => s.topic);
    this.feeds.get(exchange)?.setTopics(topics);
  }

  private onFeedEvent(event: FeedEvent) {
    const key = topicKey(event.topic);
    const state = this.topics.get(key);
    if (!state) return;
    const message: ServerMessage = event.type === 'ticker'
      ? { type: 'ticker', topic: key, data: event.ticker }
      : { type: 'candle', topic: key, data: event.candle };
    for (const id of state.clients) this.clients.get(id)?.send(message);

    if (event.type === 'candle' && event.candle.isClosed) {
      // History is built from the live stream too: Postgres keeps every closed candle we see.
      this.deps.candles.saveClosed(state.symbolId, event.topic.timeframe, [event.candle])
        .catch(error => this.deps.log?.('Saving a live candle failed', error));
    }
  }

  private broadcastStatus(exchange: string, status: FeedStatus) {
    const recipients = new Set<number>();
    for (const state of this.topics.values()) if (state.topic.exchange === exchange) state.clients.forEach(id => recipients.add(id));
    for (const id of recipients) this.clients.get(id)?.send({ type: 'status', exchange, status });
  }
}
