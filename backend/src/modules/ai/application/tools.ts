// Tools the assistant can call. Each tool validates its arguments, calls another module through a
// narrow gateway, returns compact JSON for the model, and may emit data blocks for the client.
import { z } from 'zod';
import { TIMEFRAMES } from '../../market/domain/market-options';
import type { MarketSummary } from '../../market/domain/analysis';
import type { strategyDraftSchema } from '../../strategies';
import type { ResponseBlock } from '../domain/blocks';
import type { ToolSpec } from './ports';

// ---- Gateways to other modules (implemented in ../infrastructure) --------------------------------

export type TickerView = { symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string; time: number };

export interface MarketGateway {
  readonly exchange: string;
  searchSymbols(query: string, quoteAsset?: string): Promise<{ symbol: string; baseAsset: string; quoteAsset: string }[]>;
  tickers(symbols: string[]): Promise<TickerView[]>;
  topMovers(quoteAsset: string, sort: 'volume' | 'gainers' | 'losers', limit: number): Promise<TickerView[]>;
  analyze(symbol: string, timeframe: (typeof TIMEFRAMES)[number], candles: number): Promise<{ summary: MarketSummary | null; source: 'exchange' | 'store' }>;
}

export interface StrategyDraftChecker {
  validate(draft: unknown): Promise<{ ok: true; draft: z.infer<typeof strategyDraftSchema>; summary: string[] } | { ok: false; errors: Record<string, string> }>;
}

/** Expected tool failures; the message goes back to the model so it can adjust. */
export class ToolInputError extends Error {}

// ---- Tool definitions ---------------------------------------------------------------------------

export type ToolOutcome = { result: unknown; blocks?: ResponseBlock[] };
export type AssistantTool = { spec: ToolSpec; run(args: unknown): Promise<ToolOutcome> };

function defineTool<S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.infer<S>) => Promise<ToolOutcome>): AssistantTool {
  return {
    spec: { name, description, parameters: z.toJSONSchema(schema, { io: 'input', target: 'draft-7', reused: 'ref' }) as Record<string, unknown> },
    async run(raw) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new ToolInputError(`Invalid arguments: ${parsed.error.issues.map(i => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
      }
      return run(parsed.data);
    },
  };
}

const symbol = z.string().min(2).max(30).describe('Exchange symbol such as BTCUSDT (base + quote asset, no separator)');

// ---- Compact strategy schema for models -----------------------------------------------------------
// The strict schema (strategies module) is ~8 KB of JSON Schema and is sent on every model call.
// Models get this flat ~2 KB version; arguments are then normalized and checked strictly.

const INDICATOR_FIELDS: Record<string, string[]> = {
  PRICE: [], VOLUME: [], SMA: ['period'], EMA: ['period'], RSI: ['period'],
  MACD: ['fast', 'slow', 'signal', 'line'], BOLLINGER: ['period', 'stdDev', 'band'], VALUE: ['value'],
};
const looseIndicator = z
  .object({
    type: z.enum(['PRICE', 'VOLUME', 'SMA', 'EMA', 'RSI', 'MACD', 'BOLLINGER', 'VALUE']),
    period: z.number().nullish(),
    value: z.number().nullish(),
    fast: z.number().nullish(),
    slow: z.number().nullish(),
    signal: z.number().nullish(),
    line: z.enum(['MACD', 'SIGNAL', 'HISTOGRAM']).nullish(),
    stdDev: z.number().nullish(),
    band: z.enum(['UPPER', 'MIDDLE', 'LOWER']).nullish(),
  })
  .describe('PRICE/VOLUME: no params. SMA/EMA/RSI: period. MACD: fast, slow, signal, line. BOLLINGER: period, stdDev, band. VALUE (right side only): value.');
const looseCondition = z.object({
  left: looseIndicator,
  operator: z.enum(['GT', 'LT', 'CROSSES_ABOVE', 'CROSSES_BELOW']),
  right: z.union([looseIndicator, z.number()]).describe('An indicator, or a plain number such as 30'),
});
const looseDraft = z.object({
  name: z.string().describe('Short strategy name'),
  description: z.string().nullish().describe('One or two sentences: the idea behind it'),
  definition: z.object({
    market: z.object({ exchange: z.string().describe('BINANCE'), symbol, timeframe: z.enum(TIMEFRAMES) }),
    direction: z.enum(['LONG']),
    entry: z.object({ conditions: z.array(looseCondition).describe('1-5 conditions, ALL must hold to enter') }),
    exit: z.object({
      conditions: z.array(looseCondition).describe('0-5 conditions, ANY one exits'),
      stopLossPercent: z.number().nullish().describe('0.1-50'),
      takeProfitPercent: z.number().nullish().describe('0.1-500'),
    }),
    risk: z.object({ positionSizePercent: z.number().describe('1-100, share of balance per trade') }),
  }),
});

/** Drops nulls and fields that don't belong to an indicator's type, so the strict schema can judge the rest. */
function normalizeDraft(draft: z.infer<typeof looseDraft>): unknown {
  const indicator = (i: z.infer<typeof looseIndicator>) =>
    Object.fromEntries([['type', i.type], ...(INDICATOR_FIELDS[i.type] ?? []).flatMap(k => (i as any)[k] == null ? [] : [[k, (i as any)[k]]])]);
  const condition = (c: z.infer<typeof looseCondition>) => ({
    left: indicator(c.left),
    operator: c.operator,
    right: typeof c.right === 'number' ? { type: 'VALUE', value: c.right } : indicator(c.right),
  });
  const d = draft.definition;
  return {
    name: draft.name,
    ...(draft.description ? { description: draft.description } : {}),
    definition: {
      market: d.market,
      direction: d.direction,
      entry: { conditions: d.entry.conditions.map(condition) },
      exit: {
        conditions: d.exit.conditions.map(condition),
        ...(d.exit.stopLossPercent != null && { stopLossPercent: d.exit.stopLossPercent }),
        ...(d.exit.takeProfitPercent != null && { takeProfitPercent: d.exit.takeProfitPercent }),
      },
      risk: d.risk,
    },
  };
}

export function createTools(market: MarketGateway, strategies: StrategyDraftChecker): AssistantTool[] {
  let draftCount = 0;
  return [
    defineTool(
      'search_symbols',
      'Find tradable crypto pairs by coin name or ticker. Use when unsure of the exact symbol.',
      z.strictObject({ query: z.string().min(1).max(30).describe('Coin ticker or name fragment, e.g. "sol"'), quoteAsset: z.string().max(10).optional().describe('e.g. USDT') }),
      async ({ query, quoteAsset }) => ({ result: { exchange: market.exchange, matches: await market.searchSymbols(query, quoteAsset) } }),
    ),
    defineTool(
      'get_tickers',
      'Latest price and 24-hour statistics for up to 10 pairs.',
      z.strictObject({ symbols: z.array(symbol).min(1).max(10) }),
      async ({ symbols }) => {
        const tickers = await market.tickers(symbols.map(s => s.toUpperCase()));
        return {
          result: { exchange: market.exchange, observedAt: new Date().toISOString(), tickers },
          blocks: tickers.map(t => ({ type: 'ticker' as const, data: { exchange: market.exchange, ...t } })),
        };
      },
    ),
    defineTool(
      'get_top_movers',
      'Most traded, biggest gainers or biggest losers over 24 hours.',
      z.strictObject({
        sort: z.enum(['volume', 'gainers', 'losers']),
        quoteAsset: z.string().max(10).default('USDT'),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      async ({ sort, quoteAsset, limit }) => {
        const tickers = await market.topMovers(quoteAsset.toUpperCase(), sort, limit);
        const title = { volume: 'Most traded', gainers: 'Top gainers', losers: 'Top losers' }[sort];
        return {
          result: { exchange: market.exchange, sort, quoteAsset, tickers },
          blocks: [{ type: 'market_list' as const, title: `${title} (24h, ${quoteAsset.toUpperCase()})`, data: tickers }],
        };
      },
    ),
    defineTool(
      'analyze_market',
      'Technical snapshot of one pair computed from recent candles: trend, SMA/EMA, RSI, MACD, Bollinger Bands, ATR volatility, volume and recent support/resistance.',
      z.strictObject({
        symbol,
        timeframe: z.enum(TIMEFRAMES).describe('Candle size'),
        candles: z.number().int().min(50).max(300).default(200).describe('How many recent candles to analyze'),
      }),
      async ({ symbol, timeframe, candles }) => {
        const upper = symbol.toUpperCase();
        const { summary, source } = await market.analyze(upper, timeframe, candles);
        if (!summary) throw new ToolInputError(`Not enough candle data for ${upper} on ${timeframe}.`);
        const data = { exchange: market.exchange, symbol: upper, timeframe, source, ...summary };
        return { result: data, blocks: [{ type: 'market_analysis' as const, data }] };
      },
    ),
    defineTool(
      'draft_strategy',
      'Propose a complete rule-based trading strategy. The server validates it and shows it to the user as a card they can save. Returns errors if the definition is invalid.',
      looseDraft,
      async draft => {
        const checked = await strategies.validate(normalizeDraft(draft));
        if (!checked.ok) throw new ToolInputError(`Strategy is invalid: ${Object.entries(checked.errors).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
        const draftId = `draft-${++draftCount}`;
        return {
          result: { ok: true, draftId, shownToUser: true, rules: checked.summary },
          blocks: [{ type: 'strategy_draft' as const, draftId, draft: checked.draft as unknown as Record<string, unknown>, summary: checked.summary }],
        };
      },
    ),
  ];
}
