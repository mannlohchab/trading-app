import type { Context } from '@nullarch/resin';

type OpenLot = { id: number; size: number; price: number; commission: number };
type Position = { size: number; average: number; cash: number; lots: OpenLot[] };
type ClosedLot = { id: number; quantity: number; record: { maxRunup: number; maxDrawdown: number; profit: number } };
type Fill = { location: number; price: number; after: Position; sequence: number; closed: ClosedLot[] };

/**
 * Mark equity along the emulator's OHLC path, interleaving its actual fills. Reading Resin's
 * maxDrawdown directly is insufficient: it marks the full entry bar before protective fill
 * recalculations and can count lows reached after a stop has already closed the position.
 *
 * These two pinned runtime fill hooks are isolated here and covered by execution regressions.
 * They observe state; they do not change fills, commissions or sizing.
 */
export class IntrabarEquityTracker {
  private fills: Fill[] = [];
  private path = [0, 0, 0, 0];
  private start: Position;
  private peak: number;
  private amount = 0;
  private percent = 0;
  private nextLotId = 0;
  private lotIds = new WeakMap<object, number>();
  private excursions = new Map<number, { best: number; worst: number }>();

  constructor(private readonly ctx: Context) {
    this.start = this.position();
    this.peak = ctx.strategy.initialCapital;
    const target = ctx.strategy as unknown as {
      walkNode: number;
      openTradeAt: (...args: unknown[]) => void;
      closeAt: (...args: unknown[]) => void;
    };
    for (const [name, priceIndex] of [['openTradeAt', 2], ['closeAt', 0]] as const) {
      const original = target[name];
      if (typeof original !== 'function') throw new Error('Pinned Resin fill instrumentation is unavailable.');
      target[name] = (...args) => {
        const before = this.position();
        const closedCount = ctx.strategy.closedTradeRecords.length;
        original.apply(target, args);
        const node = Math.max(0, Math.min(3, target.walkNode));
        const price = Number(args[priceIndex]);
        const from = this.path[Math.max(0, node - 1)]!, to = this.path[node]!;
        // Slippage may put the executable price beyond the candle. Mark the position at the
        // observed path price; its fill price remains in the cost basis and captures that loss.
        const fraction = from === to ? 1 : Math.max(0, Math.min(1, (price - from) / (to - from)));
        const location = node === 0 ? 0 : node - 1 + fraction;
        const mark = node === 0 ? this.path[0]! : from + fraction * (to - from);
        const closed: ClosedLot[] = [];
        let lotIndex = 0, available = Math.abs(before.lots[0]?.size ?? 0);
        for (const record of ctx.strategy.closedTradeRecords.slice(closedCount)) {
          const quantity = Math.abs(record.size), lot = before.lots[lotIndex];
          if (lot) closed.push({ id: lot.id, quantity, record });
          available -= quantity;
          if (available <= 1e-10) available = Math.abs(before.lots[++lotIndex]?.size ?? 0);
        }
        this.fills.push({ location, price: mark, after: this.position(), sequence: this.fills.length, closed });
      };
    }
  }

  private position(): Position {
    const s = this.ctx.strategy;
    return {
      size: s.posSize, average: s.posAvgPrice, cash: s.initialCapital + s.realizedPnl,
      lots: s.openTrades.map(lot => {
        let id = this.lotIds.get(lot);
        if (id === undefined) { id = this.nextLotId++; this.lotIds.set(lot, id); }
        return { id, size: lot.size, price: lot.entryPrice, commission: lot.commission };
      }),
    };
  }

  begin(open: number, high: number, low: number, close: number) {
    this.start = this.position();
    this.path = high - open < open - low ? [open, high, low, close] : [open, low, high, close];
    this.fills = [];
  }

  end(scored: boolean) {
    if (!scored) return;
    let position = this.start, node = 0;
    const mark = (price: number) => {
      const equity = position.cash + (position.size === 0 ? 0 : position.size * (price - position.average) * this.ctx.strategy.pointvalue);
      this.peak = Math.max(this.peak, equity);
      const drawdown = this.peak - equity;
      this.amount = Math.max(this.amount, drawdown);
      if (this.peak > 0) this.percent = Math.max(this.percent, drawdown / this.peak * 100);
      for (const lot of position.lots) {
        const pnl = Math.sign(lot.size) * (price - lot.price) * this.ctx.strategy.pointvalue - lot.commission / Math.abs(lot.size);
        const excursion = this.excursions.get(lot.id) ?? { best: 0, worst: 0 };
        excursion.best = Math.max(excursion.best, pnl);
        excursion.worst = Math.max(excursion.worst, -pnl);
        this.excursions.set(lot.id, excursion);
      }
    };
    for (const fill of this.fills.sort((a, b) => a.location - b.location || a.sequence - b.sequence)) {
      while (node <= fill.location) mark(this.path[node++]!);
      mark(fill.price);
      for (const closed of fill.closed) {
        const excursion = this.excursions.get(closed.id) ?? { best: 0, worst: 0 };
        closed.record.maxRunup = Math.max(excursion.best * closed.quantity, closed.record.profit, 0);
        closed.record.maxDrawdown = Math.max(excursion.worst * closed.quantity, -closed.record.profit, 0);
      }
      position = fill.after;
      mark(fill.price);
    }
    while (node <= 3) mark(this.path[node++]!);
  }

  result() { return { amount: this.amount, percent: this.percent }; }
}
