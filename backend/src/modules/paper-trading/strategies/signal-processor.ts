// Turns a strategy signal into simulated orders. The order's idempotency key is the signal id, so a
// signal processed twice (retry after a crash, two workers) creates at most one order.
import { and, eq } from 'drizzle-orm';
import { paperPositions, paperSignals } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Logger } from '../../../logger';
import { dec } from '../../backtesting';
import { timeframeMs } from '../../backtesting/utils/validation';
import type { Timeframe } from '../../market/domain/market-options';
import type { OrderService } from '../orders/order.service';
import { PaperError } from '../paper-trading.errors';
import type { PaperTradingRepository } from '../paper-trading.repository';
import type { MarketPrices } from '../paper-trading.types';
import type { InstanceConfiguration, InstanceRow } from './strategy-runner.service';

type SignalRow = typeof paperSignals.$inferSelect;

export class SignalProcessor {
  readonly metrics = { executed: 0, rejected: 0, skipped: 0, duplicatesPrevented: 0 };

  constructor(private readonly deps: { db: AppDatabase; orders: OrderService; repo: PaperTradingRepository; prices: MarketPrices; clock: { now(): Date }; log: Logger }) {}

  async process(signal: SignalRow, instance: InstanceRow, config: InstanceConfiguration): Promise<SignalRow['status']> {
    const finish = async (status: 'EXECUTED' | 'REJECTED' | 'SKIPPED', reason: string | null, orderId: string | null = null) => {
      const updated = await this.deps.db.update(paperSignals).set({ status, reason, orderId })
        .where(and(eq(paperSignals.id, signal.id), eq(paperSignals.status, 'GENERATED'))).returning({ id: paperSignals.id });
      if (!updated.length) { this.metrics.duplicatesPrevented++; return status; }
      this.metrics[status === 'EXECUTED' ? 'executed' : status === 'REJECTED' ? 'rejected' : 'skipped']++;
      this.deps.log(status === 'EXECUTED' ? 'info' : 'warn', status === 'EXECUTED' ? 'Strategy signal executed' : 'Strategy signal not executed', { instanceId: instance.id, signalId: signal.id, action: signal.action, status, reason, orderId });
      return status;
    };
    if (signal.status !== 'GENERATED') { this.metrics.duplicatesPrevented++; return signal.status; }
    if (instance.status !== 'RUNNING') return finish('SKIPPED', `Strategy is ${instance.status.toLowerCase()}`);
    // A signal is only acted on while its candle is recent: never trade on a stale decision.
    const age = this.deps.clock.now().getTime() - (signal.candleOpenTime + timeframeMs(instance.timeframe as Timeframe));
    if (age > 2 * timeframeMs(instance.timeframe as Timeframe) + 60_000) return finish('REJECTED', 'Signal is too old to act on');

    const rules = await this.deps.repo.symbolRulesById(instance.symbolId);
    if (!rules) return finish('REJECTED', 'Symbol is no longer tradable');
    const [position] = await this.deps.db.select().from(paperPositions)
      .where(and(eq(paperPositions.paperAccountId, instance.paperAccountId), eq(paperPositions.symbolId, instance.symbolId), eq(paperPositions.status, 'OPEN')));

    try {
      if (signal.action === 'ENTER_LONG') {
        if (position) return finish('SKIPPED', `A ${position.side.toLowerCase()} position is already open`);
        const quote = await this.deps.prices.quote(rules);
        if (!quote) return finish('REJECTED', 'No fresh price');
        const [account] = await this.deps.db.query.paperAccounts.findMany({ where: (a, { eq: e }) => e(a.id, instance.paperAccountId), limit: 1 });
        const cash = dec.from(account!.currentBalance), available = dec.sub(cash, dec.from(account!.reservedBalance));
        const budget = dec.min([dec.div(dec.mul(cash, config.positionSizing.value), '100'), dec.mul(available, '0.97')]); // headroom for fees and reservation buffer
        const price = quote.ask ?? quote.last;
        const quantity = dec.floorToStep(dec.div(budget, price), rules.lotSize);
        if (!(dec.cmp(quantity, '0') > 0)) return finish('REJECTED', 'Position size rounds to zero');
        const { order } = await this.deps.orders.place(instance.userId, { accountId: instance.paperAccountId, symbol: rules.symbol, side: 'BUY', type: 'MARKET', quantity, idempotencyKey: `signal:${signal.id}` }, {
          source: 'STRATEGY', strategyInstanceId: instance.id, strategyVersionId: instance.strategyVersionId, execution: config.execution,
          metadata: { signalId: signal.id, protective: config.protective },
        });
        return order.status === 'FILLED' ? finish('EXECUTED', null, order.id) : finish('REJECTED', order.rejectReason ?? `Order ${order.status.toLowerCase()}`, order.id);
      }
      // EXIT_LONG
      if (!position || position.side !== 'LONG') return finish('SKIPPED', 'No long position to exit');
      const { order } = await this.deps.orders.place(instance.userId, { accountId: instance.paperAccountId, symbol: rules.symbol, side: 'SELL', type: 'MARKET', quantity: dec.from(position.quantity), reduceOnly: true, idempotencyKey: `signal:${signal.id}` }, {
        source: 'STRATEGY', strategyInstanceId: instance.id, strategyVersionId: instance.strategyVersionId, execution: config.execution, metadata: { signalId: signal.id },
      });
      return order.status === 'FILLED' ? finish('EXECUTED', null, order.id) : finish('REJECTED', order.rejectReason ?? `Order ${order.status.toLowerCase()}`, order.id);
    } catch (error) {
      if (error instanceof PaperError) return finish('REJECTED', `${error.code}: ${error.message}`);
      throw error;
    }
  }
}
