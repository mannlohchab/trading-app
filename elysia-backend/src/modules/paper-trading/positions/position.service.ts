import { dec } from '../../backtesting';
import type { OrderService } from '../orders/order.service';
import { EXECUTION, PAPER_EXCHANGE } from '../paper-trading.constants';
import { PaperError } from '../paper-trading.errors';
import type { PaperTradingRepository } from '../paper-trading.repository';
import type { MarketPrices } from '../paper-trading.types';
import { exposure, unrealizedPnl } from '../portfolio/pnl.service';
import { positionState, type PositionRow } from '../execution/paper-execution.engine';
import type { PositionRepository } from './position.repository';

export class PositionService {
  constructor(private readonly deps: { positions: PositionRepository; orders: OrderService; repo: PaperTradingRepository; prices: MarketPrices; clock: { now(): Date } }) {}

  /** A position with its current mark. Unrealized P/L is null when no fresh price is available. */
  async view(p: PositionRow & { symbol: string }) {
    let mark: string | null = null, markTime: number | null = null;
    if (p.status === 'OPEN') {
      const rules = await this.deps.repo.symbolRulesById(p.symbolId);
      const q = rules && (await this.deps.prices.quote(rules));
      if (q && this.deps.clock.now().getTime() - q.time <= EXECUTION.maxQuoteAgeMs) { mark = q.last; markTime = q.time; }
    }
    const state = positionState(p);
    return {
      id: p.id, accountId: p.paperAccountId, exchange: PAPER_EXCHANGE, symbol: p.symbol, side: p.side, status: p.status,
      quantity: dec.from(p.quantity), averageEntryPrice: dec.from(p.averageEntryPrice), collateral: dec.from(p.collateral),
      markPrice: mark, markTime, unrealizedPnl: mark && p.status === 'OPEN' ? dec.round(unrealizedPnl(state, mark), 8) : p.status === 'OPEN' ? null : '0',
      exposure: mark && p.status === 'OPEN' ? dec.round(exposure(state, mark), 8) : '0',
      realizedPnl: dec.from(p.realizedPnl), totalFees: dec.from(p.totalFees),
      openedAt: p.openedAt, updatedAt: p.updatedAt, closedAt: p.closedAt,
    };
  }

  async list(userId: string, f: Parameters<PositionRepository['list']>[1]) {
    const { total, rows } = await this.deps.positions.list(userId, f);
    return { positions: await Promise.all(rows.map(r => this.view(r))), total, limit: f.limit, offset: f.offset };
  }

  async get(userId: string, id: string) {
    const p = await this.deps.positions.getForUser(userId, id);
    if (!p) throw new PaperError('NOT_FOUND', 'Position not found.');
    return this.view(p);
  }

  /** Closes the whole position with a reduce-only market order. Repeating the request returns the same order. */
  async close(userId: string, id: string, source: 'CLOSE' | 'LIQUIDATION' = 'CLOSE') {
    const p = await this.deps.positions.getForUser(userId, id);
    if (!p) throw new PaperError('NOT_FOUND', 'Position not found.');
    if (p.status !== 'OPEN') throw new PaperError('NO_POSITION', 'This position is already closed.');
    const { order } = await this.deps.orders.place(userId, {
      accountId: p.paperAccountId, symbol: p.symbol, side: p.side === 'LONG' ? 'SELL' : 'BUY', type: 'MARKET',
      quantity: dec.from(p.quantity), reduceOnly: true, idempotencyKey: `${source.toLowerCase()}:${p.id}`,
    }, { source });
    return { order, position: await this.get(userId, id) };
  }
}
