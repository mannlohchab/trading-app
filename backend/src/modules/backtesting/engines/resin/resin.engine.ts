// BacktestEngine implementation backed by Resin, executed in the sandboxed worker. Converts
// application inputs to the wire protocol and normalizes (and sanity-checks) what comes back.
import type { Timeframe } from '../../../market/domain/market-options';
import type { EngineInput, EngineResult, EngineTrade, PositionSizing } from '../../backtesting.types';
import { dec } from '../../utils/decimal';
import { PROTOCOL_VERSION, SIGNAL_PLOTS, type SandboxRequest } from '../../workers/protocol';
import type { BacktestWorkerManager } from '../../workers/backtest.worker-manager';
import { EngineError, type BacktestEngine, type SignalInput, type SignalSeries, type StrategySignalEngine } from '../backtest-engine.interface';

/** Pinned engine build. Upgrades are deliberate: change the dependency, rerun the regression suite, then update these. */
export const RESIN_EXPECTED_VERSION = '0.3.0';
export const RESIN_REVISION = 'fa683a0ce81bf54832805f3e386c504c144d451a';

const TV_TIMEFRAME: Record<Timeframe, SandboxRequest['chartTimeframe']> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W', '1M': 'M',
};
const QTY_TYPE: Record<PositionSizing['type'], SandboxRequest['strategy']['default_qty_type']> = {
  percent_of_equity: 'percent_of_equity', cash: 'cash', fixed_quantity: 'fixed',
};

/** Tick size "0.0025" → pricescale 10000, minmove 25 (exact, from the decimal string). */
export function tickGrid(tickSize: string): { pricescale: number; minmove: number } {
  const [int = '0', frac = ''] = dec.from(tickSize).split('.');
  const pricescale = 10 ** frac.length;
  const minmove = Number(BigInt(int) * BigInt(pricescale) + BigInt(frac || '0'));
  if (!(minmove > 0)) throw new EngineError('INVALID_INPUT', `Invalid tick size ${tickSize}`);
  return { pricescale, minmove };
}

export function toSandboxRequest(input: EngineInput): SandboxRequest {
  const c = input.candles;
  return {
    protocol: PROTOCOL_VERSION,
    engine: 'resin',
    mode: 'backtest',
    signalBars: 1,
    script: { language: 'pine', source: input.script.source },
    chartTimeframe: TV_TIMEFRAME[input.timeframe],
    // The engine computes in float64 like TradingView; exact decimals are restored on the way out.
    candles: {
      time: c.map(x => x.openTime),
      open: c.map(x => Number(x.open)),
      high: c.map(x => Number(x.high)),
      low: c.map(x => Number(x.low)),
      close: c.map(x => Number(x.close)),
      volume: c.map(x => Number(x.volume)),
    },
    symbol: { mintick: Number(input.symbol.tickSize), ...tickGrid(input.symbol.tickSize), mincontract: Number(input.symbol.lotSize), ticker: input.symbol.symbol, prefix: input.symbol.exchange },
    strategy: {
      initial_capital: Number(input.settings.initialCapital),
      commission_type: 'percent',
      commission_value: Number(input.settings.commissionPercent),
      slippage: input.settings.slippageTicks,
      default_qty_type: QTY_TYPE[input.settings.positionSizing.type],
      default_qty_value: Number(input.settings.positionSizing.value),
    },
  };
}

/**
 * Appends plots of the generated strategy's own `entrySignal`/`exitSignal` variables so signals mode
 * can read them. The strategy logic itself is untouched (same converter output as backtests).
 */
export function withSignalPlots(source: string): string {
  if (!/^entrySignal = /m.test(source) || !/^exitSignal = /m.test(source)) {
    throw new EngineError('INVALID_INPUT', 'Script does not define entrySignal/exitSignal');
  }
  return `${source.trimEnd()}\n\nplot(entrySignal ? 1 : 0, "${SIGNAL_PLOTS.entry}")\nplot(exitSignal ? 1 : 0, "${SIGNAL_PLOTS.exit}")\n`;
}

export class ResinEngine implements BacktestEngine, StrategySignalEngine {
  readonly identity = { name: 'resin', version: RESIN_EXPECTED_VERSION, revision: RESIN_REVISION };

  constructor(private readonly workers: BacktestWorkerManager) {}

  async signals(input: SignalInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<SignalSeries> {
    const request = {
      ...toSandboxRequest({ ...input, script: { ...input.script, source: withSignalPlots(input.script.source) } }),
      mode: 'signals' as const,
      signalBars: Math.min(input.bars, input.candles.length),
    };
    const response = await this.workers.runSignals(request, options);
    if (!response.ok) throw new EngineError(response.code, response.message, response.details);
    if (response.engine.version !== RESIN_EXPECTED_VERSION) {
      throw new EngineError('INVALID_OUTPUT', `Engine version ${response.engine.version} does not match the pinned ${RESIN_EXPECTED_VERSION}`);
    }
    const s = response.signals;
    const expected = input.candles.slice(-request.signalBars).map(c => c.openTime);
    if (s.time.length !== expected.length || s.time.some((t, i) => t !== expected[i])) {
      throw new EngineError('INVALID_OUTPUT', 'Signal times do not match the requested candles');
    }
    return { engine: this.identity, bars: s.time.map((time, i) => ({ openTime: time, entry: s.entry[i] === 1, exit: s.exit[i] === 1 })), durationMs: response.durationMs };
  }

  async run(input: EngineInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<EngineResult> {
    const response = await this.workers.run(toSandboxRequest(input), options);
    if (!response.ok) throw new EngineError(response.code, response.message, response.details);
    if (response.engine.version !== RESIN_EXPECTED_VERSION) {
      throw new EngineError('INVALID_OUTPUT', `Engine version ${response.engine.version} does not match the pinned ${RESIN_EXPECTED_VERSION}`);
    }

    // Semantic checks on top of the schema: the trusted side never takes engine output on faith.
    const first = input.candles[0]!.openTime, last = input.candles.at(-1)!.closeTime;
    if (response.equity.length !== input.candles.length) throw new EngineError('INVALID_OUTPUT', 'Equity curve does not match the candle count');
    for (const t of response.trades) {
      if (t.entryTime < first || t.exitTime > last || t.exitTime < t.entryTime) throw new EngineError('INVALID_OUTPUT', 'A trade falls outside the dataset');
    }
    // Engine net profit = closed trades (net of their fees) − the open position's entry fee.
    const expected = response.trades.reduce((a, t) => a + t.profit, 0) - (response.openPosition?.entryCommission ?? 0);
    if (Math.abs(expected - response.realizedPnl) > 1e-6 * Math.max(1, Math.abs(response.realizedPnl))) {
      throw new EngineError('INVALID_OUTPUT', 'Trade P/L does not reconcile with the engine\'s realized P/L');
    }

    // The engine fills on the symbol's tick and lot grids but in float64 (81269.58 + 0.02 comes back
    // as 81269.600000000002). Snap prices and sizes back onto their grids; round money to 8 places.
    const price = (v: number) => dec.roundToStep(dec.from(v), input.symbol.tickSize);
    const qty = (v: number) => dec.roundToStep(dec.from(Math.abs(v)), input.symbol.lotSize);
    const money = (v: number) => dec.round(dec.from(v), 8);
    const trades: EngineTrade[] = response.trades.map(t => ({
      side: t.size < 0 ? 'SHORT' : 'LONG',
      quantity: qty(t.size),
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      entryPrice: price(t.entryPrice),
      exitPrice: price(t.exitPrice),
      profit: money(t.profit),
      profitPercent: dec.round(dec.from(t.profitPercent), 8),
      commission: money(t.commission),
      maxRunup: money(t.maxRunup),
      maxDrawdown: money(t.maxDrawdown),
      entryId: t.entryId,
      exitId: t.exitId,
      exitReason: t.exitId === null ? 'Margin call' : t.exitComment || t.exitId,
    }));

    return {
      engine: this.identity,
      trades,
      equity: response.equity.map(money),
      realizedPnl: money(response.realizedPnl),
      openPosition: response.openPosition && {
        side: response.openPosition.size < 0 ? 'SHORT' : 'LONG',
        quantity: qty(response.openPosition.size),
        // An average of several fills need not be on the tick grid.
        averagePrice: dec.round(dec.from(response.openPosition.averagePrice), 8),
        entryCommission: money(response.openPosition.entryCommission),
        entryTime: response.openPosition.entryTime,
      },
      durationMs: response.durationMs,
    };
  }
}
