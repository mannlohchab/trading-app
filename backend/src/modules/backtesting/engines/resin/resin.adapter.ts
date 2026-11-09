// Runs INSIDE the sandboxed worker only. Converts a validated protocol request into Resin calls and
// Resin's state into a protocol response. This is the only file that touches Resin's API.
import { compile, Context, PineRuntimeHaltError, run, transpile, VERSION } from '@nullarch/resin';
import { PROTOCOL_VERSION, SIGNAL_PLOTS, type RawTrade, type SandboxRequest, type SandboxResponse, type SandboxSignalsResult } from '../../workers/protocol';

export const RESIN_VERSION = VERSION;

const failure = (code: Extract<SandboxResponse, { ok: false }>['code'], message: string, details: string[] = []): SandboxResponse => ({
  protocol: PROTOCOL_VERSION,
  ok: false,
  code,
  message: message.slice(0, 2000),
  details: details.slice(0, 50).map(d => d.slice(0, 2000)),
});

function compileScript(request: SandboxRequest) {
  return transpile(request.script.source, {
    chartTf: request.chartTimeframe,
    syminfo: {
      mintick: request.symbol.mintick,
      pricescale: request.symbol.pricescale,
      minmove: request.symbol.minmove,
      mincontract: request.symbol.mincontract,
      pointvalue: 1,
      type: 'crypto',
      timezone: 'Etc/UTC',
      prefix: request.symbol.prefix,
      ticker: request.symbol.ticker,
    },
    // Platform rules override whatever the script declares (e.g. a script claiming zero fees).
    strategy: {
      initial_capital: request.strategy.initial_capital,
      commission_type: request.strategy.commission_type,
      commission_value: request.strategy.commission_value,
      slippage: request.strategy.slippage,
      default_qty_type: request.strategy.default_qty_type,
      default_qty_value: request.strategy.default_qty_value,
    },
  });
}

const series = (c: SandboxRequest['candles']) => ({
  time: Float64Array.from(c.time),
  open: Float64Array.from(c.open),
  high: Float64Array.from(c.high),
  low: Float64Array.from(c.low),
  close: Float64Array.from(c.close),
  volume: Float64Array.from(c.volume),
});

/**
 * Signals mode (live paper strategies): runs the same script and returns its own entry/exit signal
 * for the latest bars, read from the two plots the trusted side appended. Same compiler, same
 * indicator implementations, same bar semantics as a backtest.
 */
export function executeResinSignals(request: SandboxRequest): SandboxSignalsResult {
  const started = performance.now();
  const transpiled = compileScript(request);
  if (!transpiled.ok) return failure('COMPILE_ERROR', 'The strategy script does not compile.', transpiled.errors) as SandboxSignalsResult;
  if (!transpiled.isStrategy) return failure('NOT_A_STRATEGY', 'The script is an indicator; it must declare strategy(...).') as SandboxSignalsResult;
  let plots: { title: string; values: number[] }[];
  try {
    plots = run(transpiled, series(request.candles)).plots;
  } catch (error) {
    if (error instanceof PineRuntimeHaltError) return failure('SCRIPT_HALTED', `The script stopped itself: ${error.message}`) as SandboxSignalsResult;
    return failure('RUNTIME_ERROR', `The strategy failed while running: ${error instanceof Error ? error.message : String(error)}`) as SandboxSignalsResult;
  }
  const entry = plots.find(p => p.title === SIGNAL_PLOTS.entry), exit = plots.find(p => p.title === SIGNAL_PLOTS.exit);
  if (!entry || !exit) return failure('INVALID_INPUT', 'The script does not expose entry/exit signal plots.') as SandboxSignalsResult;
  const from = Math.max(0, request.candles.time.length - request.signalBars);
  const flag = (v: number | undefined): 0 | 1 => (v === 1 ? 1 : 0); // na (warm-up) and 0 are "no signal"
  return {
    protocol: PROTOCOL_VERSION,
    ok: true,
    mode: 'signals',
    engine: { name: 'resin', version: VERSION },
    signals: {
      time: request.candles.time.slice(from),
      entry: entry.values.slice(from).map(flag),
      exit: exit.values.slice(from).map(flag),
    },
    durationMs: performance.now() - started,
  };
}

export function executeResin(request: SandboxRequest): SandboxResponse {
  const started = performance.now();
  const transpiled = compileScript(request);
  if (!transpiled.ok) return failure('COMPILE_ERROR', 'The strategy script does not compile.', transpiled.errors);
  if (!transpiled.isStrategy) return failure('NOT_A_STRATEGY', 'The script is an indicator; it must declare strategy(...).');

  const c = request.candles;
  const data = series(c);
  const equity: number[] = new Array(c.time.length);
  let ctx: Context;
  try {
    ctx = Context.from(transpiled, data);
    const bar = compile(transpiled.code)(ctx);
    for (let i = 0; i < ctx.barCount; i++) {
      ctx.advance();
      bar();
      equity[i] = ctx.strategy.equity(data.close[i]!);
    }
  } catch (error) {
    if (error instanceof PineRuntimeHaltError) return failure('SCRIPT_HALTED', `The script stopped itself: ${error.message}`);
    return failure('RUNTIME_ERROR', `The strategy failed while running: ${error instanceof Error ? error.message : String(error)}`);
  }

  const s = ctx.strategy;
  const trades: RawTrade[] = s.closedTradeRecords.map(r => ({
    entryTime: r.entryTime,
    exitTime: r.exitTime,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    size: r.size,
    profit: r.profit,
    profitPercent: r.profitPercent,
    commission: r.commission,
    maxRunup: r.maxRunup,
    maxDrawdown: r.maxDrawdown,
    entryId: r.entryId,
    exitId: r.exitId,
    entryComment: r.entryComment,
    exitComment: r.exitComment,
  }));

  return {
    protocol: PROTOCOL_VERSION,
    ok: true,
    engine: { name: 'resin', version: VERSION },
    trades,
    equity,
    realizedPnl: s.realizedPnl,
    // TradingView/Resin net profit also deducts the open position's entry commission.
    openPosition: s.posSize !== 0 ? { size: s.posSize, averagePrice: s.posAvgPrice, entryCommission: s.openCommission, entryTime: s.entryTimeOpen } : null,
    durationMs: performance.now() - started,
  };
}
