// Runs INSIDE the sandboxed worker only. Converts a validated protocol request into Resin calls and
// Resin's state into a protocol response. This is the only file that touches Resin's API.
import { compile, Context, PineRuntimeHaltError, run, transpile, VERSION } from '@nullarch/resin';
import { PROTOCOL_VERSION, SIGNAL_PLOTS, type RawTrade, type SandboxRequest, type SandboxResponse, type SandboxSignalsResult } from '../../workers/protocol';
import { IntrabarEquityTracker } from './intrabar-equity';
import { z } from 'zod';
import { strategyDefinitionSchema } from '../../../strategies/domain/definition';

export const RESIN_VERSION = VERSION;

const failure = (code: Extract<SandboxResponse, { ok: false }>['code'], message: string, details: string[] = []): SandboxResponse => ({
  protocol: PROTOCOL_VERSION,
  ok: false,
  code,
  message: message.slice(0, 2000),
  details: details.slice(0, 50).map(d => d.slice(0, 2000)),
});

function compileScript(request: SandboxRequest) {
  const schedule = sessionSchedule(request.symbol.session);
  return transpile(request.script.source, {
    chartTf: request.chartTimeframe,
    syminfo: {
      mintick: request.symbol.mintick,
      pricescale: request.symbol.pricescale,
      minmove: request.symbol.minmove,
      mincontract: request.symbol.mincontract,
      pointvalue: request.symbol.pointValue ?? 1,
      type: request.symbol.assetType ?? 'crypto',
      timezone: request.symbol.timezone ?? 'Etc/UTC',
      ...(schedule && { opening_hours: schedule }),
      prefix: request.symbol.prefix,
      ticker: request.symbol.ticker,
    },
    // Platform rules override whatever the script declares (e.g. a script claiming zero fees).
    strategy: {
      initial_capital: request.strategy.initial_capital,
      commission_type: request.strategy.commission_type,
      commission_value: request.strategy.commission_value,
      // Spread is an explicitly requested stress assumption. Round half a spread up to the
      // executable tick grid, then add adverse slippage on market/stop executions.
      slippage: request.strategy.slippage + Math.ceil((request.execution?.spreadTicks ?? 0) / 2),
      default_qty_type: request.strategy.default_qty_type,
      default_qty_value: request.strategy.default_qty_value,
    },
  });
}

function sessionSchedule(session?: string) {
  if (!session) return undefined;
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})(?::([1-7]+))?$/.exec(session);
  if (!m || Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59) throw new Error('Session must use HHmm-HHmm:days (1=Sunday, 7=Saturday).');
  return [...new Set(m[5] ?? '1234567')].map(day => ({ day: (Number(day) + 5) % 7, start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` }));
}

/**
 * Orders are disabled during pre-roll. For generated definitions, fill callbacks may only
 * update protective exits: normal signal orders remain close-only. Resin rolls indicator state
 * back after each provisional fill callback, so indicators still advance once per closed bar.
 */
function installExecutionPolicy(ctx: Context, request: SandboxRequest) {
  const s = ctx.strategy;
  const closeOnly = request.script.source.includes('// Execution policy: close-only signals; protective orders recalculate on fills.');
  const riskLine = request.script.source.split('\n').find(line => line.startsWith('// Entry protection: '));
  if (closeOnly && riskLine) {
    const protection = z.strictObject({ direction: z.enum(['LONG', 'SHORT']), exit: strategyDefinitionSchema.shape.exit }).parse(JSON.parse(riskLine.slice('// Entry protection: '.length)));
    // Attach the bracket inside the entry-fill hook, before the remaining price path or margin
    // checkpoints. Deferred calc_on_order_fills alone can otherwise liquidate a fully funded
    // short at the bar high before its protective stop is ever installed.
    type ExitLeg = { entryId: string; consumed: boolean };
    const target = s as unknown as { openTradeAt: (...args: unknown[]) => void; exitLegs: ExitLeg[]; freshLegs: ExitLeg[] };
    const open = target.openTradeAt;
    target.openTradeAt = (...args) => {
      open.apply(s, args);
      const short = protection.direction === 'SHORT';
      const entryId = short ? 'Short' : 'Long';
      if (args[0] !== entryId) return;
      const risk = protection.exit;
      const level = (percent: number, profit: boolean) => s.posAvgPrice * (1 + percent / 100 * (profit !== short ? 1 : -1));
      const stop = risk.stopLossPercent === undefined ? undefined : level(risk.stopLossPercent, false);
      const trailing = risk.trailingStop;
      const trailPrice = trailing ? level(trailing.activationPercent, true) : undefined;
      const trailOffset = trailing ? Math.max(1, Math.round(s.posAvgPrice * trailing.offsetPercent / 100 / request.symbol.mintick)) : undefined;
      const place = (id: string, percent: number | undefined, targetPrice: number | undefined, profitComment: string) => {
        s.exit(id, entryId, targetPrice, stop, undefined, undefined, trailOffset, undefined, trailPrice, undefined, undefined, percent, 'Stop loss', profitComment, true, 'Trailing stop');
      };
      const partials = risk.partialTakeProfits ?? [];
      const remaining = 100 - partials.reduce((sum, partial) => sum + partial.quantityPercent, 0);
      for (const [i, partial] of partials.entries()) place(`Partial ${i + 1}`, remaining === 0 && i === partials.length - 1 ? undefined : partial.quantityPercent, level(partial.profitPercent, true), 'Partial take profit');
      if (stop !== undefined || risk.takeProfitPercent !== undefined || trailing) {
        place('Risk', undefined, risk.takeProfitPercent === undefined ? undefined : level(risk.takeProfitPercent, true), 'Take profit');
      }
      // Newly placed/updated brackets must join this fill's remaining path, just like legs
      // attached to a pending entry by Resin.bindLegs. The queue de-duplicates existing legs.
      for (const leg of target.exitLegs) {
        if (leg.entryId === entryId && !leg.consumed && !target.freshLegs.includes(leg)) target.freshLegs.push(leg);
      }
    };
  }
  let recalculating = false;
  const recalc = ctx.recalcOnOrderFills.bind(ctx);
  ctx.recalcOnOrderFills = body => {
    recalculating = true;
    try { recalc(body); } finally { recalculating = false; }
  };
  const mayOrder = () => (request.tradingStartTime === undefined || ctx.barTimeMs >= request.tradingStartTime) && !(closeOnly && recalculating);
  let capacityBar = -1, submitted = 0;
  for (const name of ['entry', 'order'] as const) {
    const original: typeof s.entry = s[name].bind(s);
    s[name] = (...args: Parameters<typeof original>) => {
      if (!mayOrder()) return;
      const participation = request.execution?.maxVolumeParticipationPercent;
      if (participation !== undefined) {
        if (capacityBar !== ctx.idx) { capacityBar = ctx.idx; submitted = 0; }
        // The signal bar is already closed. Its volume bounds the following order's size;
        // no future volume is read and unfilled quantity is explicitly cancelled.
        const capacity = Math.max(0, ctx.volume.get(0) * participation / 100 - submitted);
        const p = ctx.close.get(0) * (request.symbol.pointValue ?? 1);
        const sizing = request.strategy;
        const desired = args[2] !== undefined && Number.isFinite(args[2]) ? args[2]
          : sizing.default_qty_type === 'fixed' ? sizing.default_qty_value
          : (sizing.default_qty_type === 'cash' ? sizing.default_qty_value : s.equity(ctx.close.get(0)) * sizing.default_qty_value / 100) / p;
        const lot = request.symbol.mincontract;
        const qty = Math.floor((Math.min(desired, capacity) + lot * 1e-9) / lot) * lot;
        if (!(qty > 0)) return;
        args[2] = qty;
        submitted += qty;
      }
      original.apply(s, args);
    };
  }
  const close = s.close.bind(s), closeAll = s.close_all.bind(s);
  s.close = (...args) => { if (mayOrder()) close(...args); };
  s.close_all = (...args) => { if (mayOrder()) closeAll(...args); };
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
  const equity: number[] = [];
  let ctx: Context;
  let tracker: IntrabarEquityTracker;
  try {
    ctx = Context.from(transpiled, data);
    const bar = compile(transpiled.code)(ctx);
    installExecutionPolicy(ctx, request);
    tracker = new IntrabarEquityTracker(ctx);
    for (let i = 0; i < ctx.barCount; i++) {
      tracker.begin(c.open[i]!, c.high[i]!, c.low[i]!, c.close[i]!);
      ctx.advance();
      bar();
      const scored = request.tradingStartTime === undefined || c.time[i]! >= request.tradingStartTime;
      tracker.end(scored);
      if (scored) equity.push(ctx.strategy.equity(data.close[i]!));
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
    intrabarDrawdown: tracker.result(),
    // TradingView/Resin net profit also deducts the open position's entry commission.
    openPosition: s.posSize !== 0 ? { size: s.posSize, averagePrice: s.posAvgPrice, entryCommission: s.openCommission, entryTime: s.entryTimeOpen } : null,
    durationMs: performance.now() - started,
  };
}
