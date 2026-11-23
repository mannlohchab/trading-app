// POC adapter: run a Pine Script v5/v6 strategy with Resin over our candles and report trades + metrics.
// Not part of the app. Runs in-process; see sandbox.ts for the isolated (worker + timeout) version.
import { compile, Context, PineRuntimeHaltError, transpile, VERSION } from '@nullarch/resin';
import type { Candle } from '../../src/modules/market/domain/types';

export const RESIN_VERSION = VERSION;

/** Resin's `chartTf` uses TradingView timeframe strings. */
const TV_TIMEFRAME: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W', '1M': 'M',
};

export type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  profit: number;
  profitPercent: number;
  commission: number;
  maxRunup: number;
  maxDrawdown: number;
  bars: number;
  entryId: string;
  exitId: string;
  exitComment: string;
};

export type BacktestMetrics = {
  bars: number;
  from: string;
  to: string;
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  netProfitPercent: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number | null;
  averageTrade: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  /** Peak-to-trough on the bar-close equity curve. */
  maxDrawdown: number;
  maxDrawdownPercent: number;
  /** Resin's own strategy.max_drawdown (intrabar, TradingView definition). */
  engineMaxDrawdown: number;
  buyAndHoldReturnPercent: number;
  exposurePercent: number;
  openPosition: { size: number; averagePrice: number } | null;
};

export type BacktestResult =
  | {
      ok: true;
      engine: { name: 'resin'; version: string };
      metrics: BacktestMetrics;
      trades: BacktestTrade[];
      equityCurve: { time: string; equity: number }[];
      timings: { transpileMs: number; runMs: number };
    }
  | { ok: false; stage: 'transpile' | 'not_a_strategy' | 'runtime' | 'halted' | 'input'; errors: string[] };

/** Symbol properties from our instrument catalog (Resin cannot look them up). */
export type SymbolInfo = { tickSize: number; stepSize: number; ticker: string; exchange: string };

/** Platform rules applied over whatever the script declares (e.g. real exchange fees). */
export type StrategyRules = {
  initialCapital?: number;
  commissionPercent?: number;
  slippageTicks?: number;
};

export type BacktestInput = {
  source: string;
  candles: Candle[];
  timeframe: string;
  symbol?: SymbolInfo;
  rules?: StrategyRules;
  /** Overrides for `input.*` values in the script, by title. */
  inputs?: Record<string, unknown>;
  /** Keep every Nth equity point (the full curve can be large). */
  equitySampleEvery?: number;
};

const round = (v: number, d = 6) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const iso = (ms: number) => new Date(ms).toISOString();

/** Our candles hold exact decimal strings; Resin (like TradingView) computes in float64. */
export function toOhlcv(candles: Candle[]) {
  return {
    open: Float64Array.from(candles, c => Number(c.open)),
    high: Float64Array.from(candles, c => Number(c.high)),
    low: Float64Array.from(candles, c => Number(c.low)),
    close: Float64Array.from(candles, c => Number(c.close)),
    volume: Float64Array.from(candles, c => Number(c.volume)),
    time: Float64Array.from(candles, c => c.openTime),
  };
}

export function runPineBacktest(input: BacktestInput): BacktestResult {
  const chartTf = TV_TIMEFRAME[input.timeframe];
  if (!chartTf) return { ok: false, stage: 'input', errors: [`Unsupported timeframe ${input.timeframe}`] };
  const candles = input.candles.filter(c => c.isClosed);
  if (candles.length < 2) return { ok: false, stage: 'input', errors: ['Need at least 2 closed candles'] };

  const t0 = performance.now();
  const transpiled = transpile(input.source, {
    chartTf,
    ...(input.symbol && {
      syminfo: {
        mintick: input.symbol.tickSize,
        mincontract: input.symbol.stepSize,
        pointvalue: 1,
        type: 'crypto',
        timezone: 'Etc/UTC',
        prefix: input.symbol.exchange,
        ticker: input.symbol.ticker,
      },
    }),
    ...(input.rules && {
      strategy: {
        ...(input.rules.initialCapital !== undefined && { initial_capital: input.rules.initialCapital }),
        ...(input.rules.commissionPercent !== undefined && { commission_type: 'percent' as const, commission_value: input.rules.commissionPercent }),
        ...(input.rules.slippageTicks !== undefined && { slippage: input.rules.slippageTicks }),
      },
    }),
  });
  const transpileMs = performance.now() - t0;
  if (!transpiled.ok) return { ok: false, stage: 'transpile', errors: transpiled.errors };
  if (!transpiled.isStrategy) return { ok: false, stage: 'not_a_strategy', errors: ['Script is an indicator; declare strategy(...)'] };

  const data = toOhlcv(candles);
  const t1 = performance.now();
  const equity: number[] = new Array(candles.length);
  let barsInPosition = 0;
  let ctx: Context;
  try {
    ctx = Context.from(transpiled, data, { inputs: input.inputs });
    const bar = compile(transpiled.code)(ctx);
    for (let i = 0; i < ctx.barCount; i++) {
      ctx.advance();
      bar();
      equity[i] = ctx.strategy.equity(data.close[i]!);
      if (ctx.strategy.posSize !== 0) barsInPosition++;
    }
  } catch (error) {
    if (error instanceof PineRuntimeHaltError) return { ok: false, stage: 'halted', errors: [error.message] };
    return { ok: false, stage: 'runtime', errors: [error instanceof Error ? error.message : String(error)] };
  }
  const runMs = performance.now() - t1;

  const s = ctx.strategy;
  const trades: BacktestTrade[] = s.closedTradeRecords.map(r => ({
    entryTime: iso(r.entryTime),
    exitTime: iso(r.exitTime),
    entryPrice: round(r.entryPrice, 8),
    exitPrice: round(r.exitPrice, 8),
    size: round(r.size, 8),
    profit: round(r.profit, 4),
    profitPercent: round(r.profitPercent, 4),
    commission: round(r.commission, 4),
    maxRunup: round(r.maxRunup, 4),
    maxDrawdown: round(r.maxDrawdown, 4),
    bars: r.exitBarIndex - r.entryBarIndex,
    entryId: r.entryId,
    exitId: r.exitId ?? 'margin call',
    exitComment: r.exitComment,
  }));

  let peak = -Infinity, maxDd = 0, maxDdPct = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDd = Math.max(maxDd, peak - e);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, ((peak - e) / peak) * 100);
  }
  const wins = trades.filter(t => t.profit > 0), losses = trades.filter(t => t.profit < 0);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 4) : null);
  const finalEquity = equity.at(-1)!;
  const sample = Math.max(1, input.equitySampleEvery ?? 1);

  return {
    ok: true,
    engine: { name: 'resin', version: VERSION },
    metrics: {
      bars: candles.length,
      from: iso(candles[0]!.openTime),
      to: iso(candles.at(-1)!.closeTime),
      initialCapital: s.initialCapital,
      finalEquity: round(finalEquity, 4),
      netProfit: round(s.realizedPnl, 4),
      netProfitPercent: round((s.realizedPnl / s.initialCapital) * 100, 4),
      grossProfit: round(s.grossProfit, 4),
      grossLoss: round(s.grossLoss, 4),
      profitFactor: s.grossLoss < 0 ? round(s.grossProfit / -s.grossLoss, 4) : null,
      totalTrades: s.closedTrades,
      winningTrades: s.winTrades,
      losingTrades: s.lossTrades,
      winRatePercent: s.closedTrades ? round((s.winTrades / s.closedTrades) * 100, 2) : null,
      averageTrade: avg(trades.map(t => t.profit)),
      averageWin: avg(wins.map(t => t.profit)),
      averageLoss: avg(losses.map(t => t.profit)),
      largestWin: wins.length ? Math.max(...wins.map(t => t.profit)) : null,
      largestLoss: losses.length ? Math.min(...losses.map(t => t.profit)) : null,
      maxDrawdown: round(maxDd, 4),
      maxDrawdownPercent: round(maxDdPct, 4),
      engineMaxDrawdown: round(s.maxDrawdown, 4),
      buyAndHoldReturnPercent: round(((data.close.at(-1)! - data.open[0]!) / data.open[0]!) * 100, 4),
      exposurePercent: round((barsInPosition / candles.length) * 100, 2),
      openPosition: s.posSize !== 0 ? { size: round(s.posSize, 8), averagePrice: round(s.posAvgPrice, 8) } : null,
    },
    trades,
    equityCurve: equity.flatMap((e, i) => (i % sample === 0 || i === equity.length - 1 ? [{ time: iso(candles[i]!.openTime), equity: round(e, 4) }] : [])),
    timings: { transpileMs: round(transpileMs, 2), runMs: round(runMs, 2) },
  };
}
