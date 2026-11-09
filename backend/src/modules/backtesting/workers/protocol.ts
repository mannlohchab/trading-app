// Wire protocol between the trusted process and the sandboxed worker. Both sides validate every
// message against these schemas; nothing else crosses the boundary.
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
const MAX_SOURCE_CHARS = 100_000;
const MAX_BARS = 50_000;
const MAX_TRADES = 200_000;

const finite = z.number().finite();
const series = z.array(finite).max(MAX_BARS);

export const sandboxRequestSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  engine: z.literal('resin'),
  /** "backtest": trades and equity. "signals": the script's per-bar entry/exit signals (live strategies). */
  mode: z.enum(['backtest', 'signals']).default('backtest'),
  /** signals mode: how many of the latest bars to return. */
  signalBars: z.number().int().min(1).max(1000).default(1),
  script: z.strictObject({ language: z.literal('pine'), source: z.string().min(1).max(MAX_SOURCE_CHARS) }),
  /** TradingView timeframe string ("1", "60", "240", "D", "W", "M"). */
  chartTimeframe: z.enum(['1', '5', '15', '30', '60', '240', 'D', 'W', 'M']),
  candles: z
    .strictObject({ time: series, open: series, high: series, low: series, close: series, volume: series })
    .refine(c => [c.open, c.high, c.low, c.close, c.volume].every(s => s.length === c.time.length), 'Candle series lengths differ')
    .refine(c => c.time.length >= 2, 'Need at least 2 candles'),
  /** Resin requires mintick === minmove / pricescale (TradingView's symbol model). */
  symbol: z.strictObject({
    mintick: finite.positive(),
    pricescale: z.number().int().positive().max(1e15),
    minmove: z.number().int().positive().max(1e15),
    mincontract: finite.positive(),
    ticker: z.string().max(30),
    prefix: z.string().max(30),
  }),
  strategy: z.strictObject({
    initial_capital: finite.positive(),
    commission_type: z.literal('percent'),
    commission_value: finite.min(0).max(100),
    slippage: z.number().int().min(0).max(100_000),
    default_qty_type: z.enum(['percent_of_equity', 'cash', 'fixed']),
    default_qty_value: finite.positive(),
  }),
});
export type SandboxRequest = z.infer<typeof sandboxRequestSchema>;

export const rawTradeSchema = z.strictObject({
  entryTime: finite,
  exitTime: finite,
  entryPrice: finite.positive(),
  exitPrice: finite.positive(),
  /** Signed: negative for shorts. */
  size: finite.refine(v => v !== 0, 'Trade size cannot be 0'),
  profit: finite,
  profitPercent: finite,
  commission: finite.min(0),
  maxRunup: finite,
  maxDrawdown: finite,
  entryId: z.string().max(200),
  exitId: z.string().max(200).nullable(),
  entryComment: z.string().max(500),
  exitComment: z.string().max(500),
});
export type RawTrade = z.infer<typeof rawTradeSchema>;

/** Plot titles the trusted side appends to a script in signals mode. */
export const SIGNAL_PLOTS = { entry: '__paper_entry', exit: '__paper_exit' } as const;

export const sandboxSignalsResponseSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  ok: z.literal(true),
  mode: z.literal('signals'),
  engine: z.strictObject({ name: z.literal('resin'), version: z.string().max(40) }),
  signals: z.strictObject({
    time: z.array(finite).max(1000),
    entry: z.array(z.union([z.literal(0), z.literal(1)])).max(1000),
    exit: z.array(z.union([z.literal(0), z.literal(1)])).max(1000),
  }).refine(s => s.entry.length === s.time.length && s.exit.length === s.time.length, 'Signal series lengths differ'),
  durationMs: finite.min(0),
});
export type SandboxSignalsResponse = z.infer<typeof sandboxSignalsResponseSchema>;

export const sandboxFailureSchema = z.strictObject({
  protocol: z.literal(PROTOCOL_VERSION),
  ok: z.literal(false),
  code: z.enum(['COMPILE_ERROR', 'NOT_A_STRATEGY', 'RUNTIME_ERROR', 'SCRIPT_HALTED', 'INVALID_INPUT']),
  message: z.string().max(2000),
  details: z.array(z.string().max(2000)).max(50),
});
export const sandboxSignalsResultSchema = z.discriminatedUnion('ok', [sandboxSignalsResponseSchema, sandboxFailureSchema]);
export type SandboxSignalsResult = z.infer<typeof sandboxSignalsResultSchema>;

export const sandboxResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    protocol: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    engine: z.strictObject({ name: z.literal('resin'), version: z.string().max(40) }),
    trades: z.array(rawTradeSchema).max(MAX_TRADES),
    equity: series,
    realizedPnl: finite,
    openPosition: z.strictObject({ size: finite, averagePrice: finite.positive(), entryCommission: finite.min(0), entryTime: finite }).nullable(),
    durationMs: finite.min(0),
  }),
  z.strictObject({
    protocol: z.literal(PROTOCOL_VERSION),
    ok: z.literal(false),
    code: z.enum(['COMPILE_ERROR', 'NOT_A_STRATEGY', 'RUNTIME_ERROR', 'SCRIPT_HALTED', 'INVALID_INPUT']),
    message: z.string().max(2000),
    details: z.array(z.string().max(2000)).max(50),
  }),
]);
export type SandboxResponse = z.infer<typeof sandboxResponseSchema>;
