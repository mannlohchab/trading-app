// The live paper-trading engine. Runs in one process per deployment role (see config); everything it
// changes goes through idempotent, row-locked transactions, so a second running copy would only
// duplicate work, never trades.
//
//  - Market data: an internal client of the existing market hub (same single Binance WebSocket, same
//    de-duplicated upstream subscriptions). Subscribes only to tickers for symbols with open orders
//    or positions, and to candle streams for running strategies.
//  - Orders: an in-memory index of open orders, refreshed from Postgres every few seconds (one query,
//    not one per tick). Each ticker re-checks that symbol's orders; fills run per symbol in their own
//    promise chain so a slow symbol never blocks others.
//  - Strategies: a closed-candle event enqueues an evaluation job (deduplicated per instance). A
//    periodic sweep enqueues instances that fell behind (missed events, restarts, reconnects).
//  - Shorts are force-closed when their loss reaches their collateral.
import { and, count, eq, inArray, lt } from 'drizzle-orm';
import { paperAccounts, paperOrders, paperStrategyInstances, tradingSymbols } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Logger } from '../../../logger';
import { dec } from '../../backtesting';
import type { LiveMarketHub, ServerMessage } from '../../market/application/live-market.hub';
import { LIMITS as MARKET_LIMITS } from '../../market/domain/rules';
import type { Ticker } from '../../market/domain/types';
import type { PaperExecutionEngine } from '../execution/paper-execution.engine';
import type { QuoteBook } from '../execution/quote-book';
import type { OrderRepository } from '../orders/order.repository';
import type { OrderService } from '../orders/order.service';
import { ENGINE, EXECUTION } from '../paper-trading.constants';
import type { PaperTradingRepository } from '../paper-trading.repository';
import { lossRatio } from '../portfolio/pnl.service';
import type { PositionRepository } from '../positions/position.repository';
import type { PositionService } from '../positions/position.service';
import type { StrategyEvaluator } from '../strategies/strategy-evaluator';
import type { SignalProcessor } from '../strategies/signal-processor';
import type { StrategyRunnerService } from '../strategies/strategy-runner.service';

type HubClient = { id: number; topics: Set<string> };

export class PaperTradingEngine {
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private clients: HubClient[] = [];
  private ordersBySymbol = new Map<string, string[]>();
  private positionsBySymbol = new Map<string, { id: string; userId: string; side: 'LONG' | 'SHORT'; quantity: string; averageEntryPrice: string; collateral: string }[]>();
  private instancesByCandleTopic = new Map<string, string[]>();
  private symbolWork = new Map<string, { running: boolean; dirty: boolean; done: Promise<void> }>();
  private feedStatus = new Map<string, string>();
  private lastTick = new Map<string, number>();
  readonly counters = { tickers: 0, outOfOrderTickers: 0, closedCandles: 0, sweeps: 0, liquidations: 0, expiredMarketOrders: 0, engineErrors: 0 };

  constructor(private readonly deps: {
    db: AppDatabase; hub: LiveMarketHub; quotes: QuoteBook; execution: PaperExecutionEngine; orders: OrderRepository; orderService: OrderService;
    positions: PositionRepository; positionService: PositionService; strategies: StrategyRunnerService; evaluator: StrategyEvaluator; signals: SignalProcessor;
    repo: PaperTradingRepository; clock: { now(): Date }; log: Logger;
  }) {}

  async start() {
    if (this.running) return;
    this.running = true;
    await this.refresh();
    await this.sweep();
    this.timers.push(
      setInterval(() => void this.refresh().catch(e => this.error('refresh', e)), ENGINE.refreshIntervalMs),
      setInterval(() => void this.sweep().catch(e => this.error('sweep', e)), ENGINE.sweepIntervalMs),
      setInterval(() => void this.metrics().then(m => this.deps.log('info', 'Paper engine metrics', m)).catch(e => this.error('metrics', e)), ENGINE.metricsIntervalMs),
    );
    this.deps.log('info', 'Paper trading engine started', {});
  }

  async stop() {
    this.running = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    for (const c of this.clients) this.deps.hub.disconnect(c.id);
    this.clients = [];
    await Promise.allSettled([...this.symbolWork.values()].map(w => w.done));
  }

  // ---- Subscriptions and indexes --------------------------------------------------------------

  /** Reloads open orders, positions and live strategies, and aligns hub subscriptions with them. */
  async refresh() {
    const [orders, positions, instances] = await Promise.all([
      this.deps.orders.openForEngine(),
      this.deps.positions.openForEngine(),
      this.deps.db.select({ id: paperStrategyInstances.id, timeframe: paperStrategyInstances.timeframe, symbol: tradingSymbols.symbol })
        .from(paperStrategyInstances).innerJoin(tradingSymbols, eq(tradingSymbols.id, paperStrategyInstances.symbolId))
        .where(inArray(paperStrategyInstances.status, ['CREATED', 'RUNNING'])),
    ]);
    const bySymbol = new Map<string, string[]>();
    for (const o of orders) bySymbol.set(`${o.exchange}:${o.symbol}`, [...(bySymbol.get(`${o.exchange}:${o.symbol}`) ?? []), o.id]);
    this.ordersBySymbol = bySymbol;
    const pos = new Map<string, NonNullable<ReturnType<PaperTradingEngine['positionsBySymbol']['get']>>>();
    for (const { p, symbol, exchange, userId } of positions) {
      const key = `${exchange}:${symbol}`;
      pos.set(key, [...(pos.get(key) ?? []), { id: p.id, userId, side: p.side, quantity: p.quantity, averageEntryPrice: p.averageEntryPrice, collateral: p.collateral }]);
    }
    this.positionsBySymbol = pos;
    const candles = new Map<string, string[]>();
    for (const i of instances) {
      const topic = `candles:BINANCE:${i.symbol}:${i.timeframe}`;
      candles.set(topic, [...(candles.get(topic) ?? []), i.id]);
    }
    this.instancesByCandleTopic = candles;

    const wanted = new Set<string>([
      ...[...bySymbol.keys(), ...pos.keys()].map(k => `ticker:${k}`),
      ...candles.keys(),
    ]);
    await this.align(wanted);
  }

  /** Subscribes/unsubscribes hub topics, spread over internal hub clients (the hub caps topics per client). */
  private async align(wanted: Set<string>) {
    for (const c of this.clients) {
      const drop = [...c.topics].filter(t => !wanted.has(t));
      if (drop.length) { this.deps.hub.unsubscribe(c.id, drop); drop.forEach(t => c.topics.delete(t)); }
    }
    const have = new Set(this.clients.flatMap(c => [...c.topics]));
    const missing = [...wanted].filter(t => !have.has(t));
    while (missing.length) {
      let client = this.clients.find(c => c.topics.size < MARKET_LIMITS.topicsPerConnection);
      if (!client) {
        client = { id: this.deps.hub.connect(m => this.onMessage(m)), topics: new Set() };
        this.clients.push(client);
      }
      const batch = missing.splice(0, MARKET_LIMITS.topicsPerConnection - client.topics.size);
      batch.forEach(t => client!.topics.add(t));
      await this.deps.hub.subscribe(client.id, batch);
    }
  }

  // ---- Market events ---------------------------------------------------------------------------

  private onMessage(m: ServerMessage) {
    if (!this.running) return;
    if (m.type === 'ticker') this.onTicker(m.data);
    else if (m.type === 'candle' && m.data.isClosed) this.onClosedCandle(m.topic);
    else if (m.type === 'status') {
      this.feedStatus.set(m.exchange, m.status);
      // While the stream is not live its quotes are not trusted; market orders fall back to REST.
      if (m.status !== 'live') this.deps.quotes.invalidate(m.exchange);
    }
  }

  private onTicker(t: Ticker) {
    this.counters.tickers++;
    if (!this.deps.quotes.observe(t.exchange, t)) { this.counters.outOfOrderTickers++; return; } // duplicate or out of order
    const key = `${t.exchange}:${t.symbol}`;
    this.lastTick.set(key, t.time);
    this.enqueueForSymbol(key);
  }

  /** Coalesces work per symbol: one pass at a time; ticks arriving meanwhile cause exactly one more pass. */
  private enqueueForSymbol(key: string) {
    const work = this.symbolWork.get(key);
    if (work?.running) { work.dirty = true; return; }
    const state = { running: true, dirty: false, done: Promise.resolve() };
    state.done = (async () => {
      do {
        state.dirty = false;
        await this.processSymbol(key).catch(e => this.error('symbol', e));
      } while (state.dirty && this.running);
      state.running = false;
    })();
    this.symbolWork.set(key, state);
  }

  /** Resolves when every queued per-symbol pass has finished (tests and shutdown). */
  async idle() {
    while ([...this.symbolWork.values()].some(w => w.running)) await Promise.allSettled([...this.symbolWork.values()].map(w => w.done));
  }

  /** Tries every open order on the symbol against the latest quote; checks shorts for liquidation. */
  async processSymbol(key: string) {
    const [exchange, symbol] = key.split(':') as [string, string];
    const quote = this.deps.quotes.latest(exchange, symbol);
    if (!quote) return;
    let changed = false;
    for (const orderId of this.ordersBySymbol.get(key) ?? []) {
      const r = await this.deps.execution.fill(orderId, quote).catch(e => { this.error('fill', e); return null; });
      if (r && r.outcome !== 'waiting' && r.outcome !== 'stale') changed = true;
    }
    for (const p of this.positionsBySymbol.get(key) ?? []) {
      if (p.side !== 'SHORT') continue;
      const state = { side: p.side, quantity: dec.from(p.quantity), averageEntryPrice: dec.from(p.averageEntryPrice), collateral: dec.from(p.collateral) };
      if (dec.cmp(lossRatio(state, quote.last), EXECUTION.liquidationLossRatio) >= 0) {
        this.counters.liquidations++;
        this.deps.log('warn', 'Liquidating short position at its collateral limit', { positionId: p.id, mark: quote.last });
        await this.deps.positionService.close(p.userId, p.id, 'LIQUIDATION').catch(e => this.error('liquidation', e));
        changed = true;
      }
    }
    if (changed) await this.refresh();
  }

  private onClosedCandle(topic: string) {
    this.counters.closedCandles++;
    for (const instanceId of this.instancesByCandleTopic.get(topic) ?? []) {
      void this.deps.strategies.schedule(instanceId).catch(e => this.error('schedule', e));
    }
  }

  // ---- Periodic recovery -----------------------------------------------------------------------

  /** Catches up strategies that missed events, retries stuck signals, expires market orders without a price. */
  async sweep() {
    this.counters.sweeps++;
    for (const id of await this.deps.strategies.dueInstances()) await this.deps.strategies.schedule(id);

    const cutoff = new Date(this.deps.clock.now().getTime() - EXECUTION.marketOrderTimeoutMs);
    const stuck = await this.deps.db.select({ id: paperOrders.id, symbolId: paperOrders.symbolId }).from(paperOrders)
      .where(and(eq(paperOrders.orderType, 'MARKET'), eq(paperOrders.status, 'PENDING'), lt(paperOrders.createdAt, cutoff)));
    for (const o of stuck) {
      const rules = await this.deps.repo.symbolRulesById(o.symbolId);
      const quote = rules && (await this.deps.quotes.quote(rules));
      const filled = quote ? await this.deps.execution.fill(o.id, quote) : null;
      if (!filled || filled.outcome === 'stale' || filled.outcome === 'waiting') {
        if (await this.deps.orderService.endIfOpen(o.id, 'EXPIRED', 'No fresh price within the market-order timeout')) this.counters.expiredMarketOrders++;
      }
    }
  }

  // ---- Monitoring ------------------------------------------------------------------------------

  async metrics() {
    const [[accounts], [strategies], orders] = await Promise.all([
      this.deps.db.select({ n: count() }).from(paperAccounts).where(eq(paperAccounts.status, 'ACTIVE')),
      this.deps.db.select({ n: count() }).from(paperStrategyInstances).where(eq(paperStrategyInstances.status, 'RUNNING')),
      this.deps.orders.gauges(),
    ]);
    const openPositions = [...this.positionsBySymbol.values()].reduce((a, l) => a + l.length, 0);
    const p95 = (xs: number[]) => (xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!) : null);
    const now = this.deps.clock.now().getTime();
    return {
      activeAccounts: accounts?.n ?? 0,
      runningStrategies: strategies?.n ?? 0,
      openPositions,
      openOrders: orders.openOrders,
      evaluationLatencyP95Ms: p95(this.deps.evaluator.metrics.latencyMs),
      orderExecutionLatencyP95Ms: p95(this.deps.execution.metrics.fillLatencyMs),
      fills: this.deps.execution.metrics.fills,
      failedExecutions: this.deps.execution.metrics.failures + this.deps.execution.metrics.rejectedFills,
      duplicateSignalsPrevented: this.deps.signals.metrics.duplicatesPrevented,
      missedCandleRecoveries: this.deps.evaluator.metrics.recoveries,
      evaluations: this.deps.evaluator.metrics.evaluations,
      evaluationCacheHits: this.deps.evaluator.metrics.cacheHits,
      subscriptions: this.clients.reduce((a, c) => a + c.topics.size, 0),
      feedStatus: Object.fromEntries(this.feedStatus),
      oldestTickAgeMs: this.lastTick.size ? Math.max(...[...this.lastTick.values()].map(t => now - t)) : null,
      ...this.counters,
    };
  }

  private error(where: string, e: unknown) {
    this.counters.engineErrors++;
    this.deps.log('error', 'Paper engine error', { where, error: e instanceof Error ? e.message : String(e) });
  }
}
