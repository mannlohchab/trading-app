// Tools the assistant can call. Each tool validates its arguments, calls another module through a
// narrow gateway, returns compact JSON for the model, and may emit data blocks for the client.
import { z } from 'zod';
import { TIMEFRAMES } from '../../market/domain/market-options';
import type { MarketSummary } from '../../market/domain/analysis';
import type { strategyDraftSchema } from '../../strategies';
import { buildChart, CHART_OVERLAYS, CHART_WARMUP, type ChartCandleInput } from '../domain/chart';
import { APP_GUIDE, GUIDE_TOPICS, guideIndex } from '../domain/app-guide';
import { defineTool, ToolInputError, type AssistantTool } from './tool-definition';
export { ToolInputError, type AssistantTool, type ToolOutcome } from './tool-definition';
import { looseDraft, normalizeDraft } from './strategy-tool-schema';
import { createResearchTools } from './research-tools';
import { createNextStepsTool } from './next-steps-tool';
import { AiProviderError } from './errors';
import type { WebResearchBrief } from './web-research-agent';
import type { BacktestResearchGateway } from '../infrastructure/backtest-research.gateway';
import type { LiveTestingGateway } from '../infrastructure/live-testing.gateway';
import type { PreviewBacktestRequest } from '../../backtesting/backtesting.schemas';

// ---- Gateways to other modules (implemented in ../infrastructure) --------------------------------

export type TickerView = { symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string; time: number };

export interface MarketGateway {
  readonly exchange: string;
  searchSymbols(query: string, quoteAsset?: string): Promise<{ symbol: string; baseAsset: string; quoteAsset: string }[]>;
  tickers(symbols: string[]): Promise<TickerView[]>;
  topMovers(quoteAsset: string, sort: 'volume' | 'gainers' | 'losers', limit: number): Promise<TickerView[]>;
  analyze(symbol: string, timeframe: (typeof TIMEFRAMES)[number], candles: number): Promise<{ summary: MarketSummary | null; source: 'exchange' | 'store' }>;
  candles(symbol: string, timeframe: (typeof TIMEFRAMES)[number], limit: number): Promise<{ candles: ChartCandleInput[]; source: 'exchange' | 'store' }>;
}

export interface StrategyDraftChecker {
  validate(draft: unknown): Promise<{ ok: true; draft: z.infer<typeof strategyDraftSchema>; summary: string[] } | { ok: false; errors: Record<string, string> }>;
}

/** The user's own holdings, valued by the portfolio module. */
export interface PortfolioGateway {
  valuation(userId: string): Promise<import('../../portfolio').PortfolioValuation & { updatedAt: Date | null }>;
  /** The stored rows without prices (cheap; used for the per-turn snapshot). */
  list(userId: string): Promise<{ holdings: { asset: string }[] }>;
}

/** Runs a real sandboxed backtest of an unsaved strategy definition (AI draft preview). */
export interface BacktestGateway {
  preview(userId: string, request: {
    name?: string;
    definition: unknown;
    candles?: number;
    range?: PreviewBacktestRequest['range'];
    market?: { exchange?: string; symbol?: string; timeframe?: (typeof TIMEFRAMES)[number] };
    settings?: PreviewBacktestRequest['settings'];
    riskStatistics?: PreviewBacktestRequest['riskStatistics'];
  }): Promise<{
    market: { exchange: string; symbol: string; timeframe: string };
    range: { start: number; end: number };
    metrics: Record<string, unknown>;
    warnings: { code: string; message: string }[];
    trades: Record<string, unknown>[];
    equityCurve: { time: number; equity: string }[];
    engine: { name: string; version: string; revision?: string };
    dataset: { candles: number };
    settings?: unknown;
    executionAssumptions?: unknown;
  }>;
}

const symbol = z.string().min(2).max(30).describe('Exchange symbol such as BTCUSDT (base + quote asset, no separator)');

// ---- Compact strategy schema for models -----------------------------------------------------------
// Models get a compact flat indicator schema; arguments are then normalized and checked
// against the full strategies schema before they can be saved or backtested.

/** Positions sent to the model; the rest are summarised so the result stays within the tool budget. */
const MAX_POSITIONS_IN_TOOL = 30;

/** Charts per reply: enough to compare two pairs, few enough to keep a phone screen readable. */
const MAX_CHARTS_PER_TURN = 2;

/** Trades shown on the backtest card; full count stays in metrics.totalTrades. */
const MAX_BACKTEST_TRADES_IN_BLOCK = 25;
/** One backtest per turn keeps sandbox load and chat cards readable. */
const MAX_BACKTESTS_PER_TURN = 1;

export type WebResearchGateway = {
  research(question: string, signal?: AbortSignal): Promise<WebResearchBrief>;
};

export function createTools(
  market: MarketGateway,
  strategies: StrategyDraftChecker,
  portfolio?: { gateway: PortfolioGateway; userId: string },
  backtest?: { gateway: BacktestGateway; userId: string },
  research?: { gateway: BacktestResearchGateway; userId: string },
  liveTesting?: { gateway: LiveTestingGateway; userId: string },
  webResearch?: WebResearchGateway,
): AssistantTool[] {
  let draftCount = 0;
  let chartCount = 0;
  let backtestCount = 0;
  let webResearchCount = 0;
  /** Drafts produced earlier in this turn, so run_backtest can reference draftId. */
  const drafts = new Map<string, { name: string; definition: unknown; summary: string[] }>();
  return [
    defineTool(
      'get_app_guide',
      'How the TradingGurukul app works: where each feature is, the exact screen and button names, and what is not available. Call before telling the user how to do something in the app. Pass 1-3 topics; omit topics to list them.',
      z.strictObject({
        topics: z.array(z.enum(GUIDE_TOPICS)).max(3).optional().describe('Guide sections to read'),
      }),
      async ({ topics }) => ({
        result: topics?.length
          ? { topics: Object.fromEntries(topics.map(id => [id, APP_GUIDE[id]])), note: 'Quote labels exactly as written here.' }
          : { index: guideIndex(), note: 'Call again with the topics you need.' },
      }),
    ),
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
      'show_chart',
      'Show the user a price chart of one pair drawn from real candles, optionally with moving averages and recent support/resistance lines. Use when the user asks to see a chart or graph, or when a picture makes a trend, level or crossover clearer. Returns the values drawn so you can describe them.',
      z.strictObject({
        symbol,
        timeframe: z.enum(TIMEFRAMES).describe('Candle size'),
        candles: z.number().int().min(20).max(150).default(60).describe('How many recent candles to show'),
        chartType: z.enum(['candle', 'line']).default('candle'),
        overlays: z.array(z.enum(CHART_OVERLAYS)).max(4).default(['SUPPORT_RESISTANCE']).describe('Lines to draw on the chart'),
      }),
      async ({ symbol, timeframe, candles, chartType, overlays }) => {
        if (chartCount >= MAX_CHARTS_PER_TURN) throw new ToolInputError(`At most ${MAX_CHARTS_PER_TURN} charts per answer; the user already sees them.`);
        const upper = symbol.toUpperCase();
        // Extra history so moving averages are defined from the first visible candle.
        const history = await market.candles(upper, timeframe, candles + CHART_WARMUP + 1);
        const chart = buildChart({ exchange: market.exchange, symbol: upper, timeframe, chartType, candles: history.candles, visible: candles, overlays, source: history.source });
        if (!chart) throw new ToolInputError(`Not enough candle data for ${upper} on ${timeframe}.`);
        chartCount++;
        const first = chart.candles[0]!, last = chart.candles.at(-1)!;
        return {
          result: {
            shownToUser: true, exchange: chart.exchange, symbol: upper, timeframe, candles: chart.candles.length,
            from: new Date(first[0]).toISOString(), to: new Date(last[0]).toISOString(),
            lastClose: chart.lastClose, changePercent: chart.changePercent,
            levels: chart.levels.map(l => ({ kind: l.kind, price: l.price })),
            latest: Object.fromEntries(chart.lines.map(l => [l.id, l.values.at(-1)])),
          },
          blocks: [{ type: 'chart' as const, data: chart }],
        };
      },
    ),
    defineTool(
      'draft_strategy',
      'Propose a complete rule-based trading strategy. The server validates it and shows a card the user can save. Default to LONG with one entry and fixed stops/targets. Explicitly requested SHORT, pyramiding, trailing stops and partial exits are supported for historical backtests, not paper trading. Returns errors for invalid definitions.',
      looseDraft,
      async draft => {
        const checked = await strategies.validate(normalizeDraft(draft));
        if (!checked.ok) throw new ToolInputError(`Strategy is invalid: ${Object.entries(checked.errors).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
        const draftId = `draft-${++draftCount}`;
        drafts.set(draftId, { name: checked.draft.name, definition: checked.draft.definition, summary: checked.summary });
        return {
          result: { ok: true, draftId, shownToUser: true, rules: checked.summary },
          blocks: [{ type: 'strategy_draft' as const, draftId, draft: checked.draft as unknown as Record<string, unknown>, summary: checked.summary }],
        };
      },
    ),
    ...(backtest && !research ? [defineTool(
      'run_backtest',
      'Run a real historical backtest of a strategy on closed candles in the sandboxed engine (not LLM-estimated). Prefer draftId from draft_strategy in this turn, or pass the full definition. Returns engine metrics, recent trades and an equity curve for the app to display. Call after drafting when the user asks to backtest, simulate, or see how a strategy would have performed.',
      z.strictObject({
        draftId: z.string().min(1).max(40).optional().describe('Id returned by draft_strategy in this turn'),
        name: z.string().min(1).max(80).optional().describe('Strategy name when passing definition directly'),
        definition: looseDraft.shape.definition.optional().describe('Full strategy definition when draftId is not used'),
        candles: z.number().int().min(100).max(1500).default(500).describe('How many recent closed candles to simulate'),
      }).refine(v => !!v.draftId || !!v.definition, { message: 'Provide draftId or definition' }),
      async ({ draftId, name, definition, candles }) => {
        if (backtestCount >= MAX_BACKTESTS_PER_TURN) {
          throw new ToolInputError(`At most ${MAX_BACKTESTS_PER_TURN} backtest per answer; refer to the card already shown.`);
        }
        let resolvedName = name;
        let resolvedDefinition: unknown = definition;
        if (draftId) {
          const prior = drafts.get(draftId);
          if (!prior) throw new ToolInputError(`Unknown draftId "${draftId}". Call draft_strategy first in this turn, or pass definition.`);
          resolvedName = resolvedName ?? prior.name;
          resolvedDefinition = prior.definition;
        }
        if (!resolvedDefinition) throw new ToolInputError('Provide draftId or definition.');

        // Normalize when the model sent a loose definition (same path as draft_strategy).
        let validatedDefinition = resolvedDefinition;
        if (definition && !draftId) {
          const checked = await strategies.validate(normalizeDraft({ name: resolvedName ?? 'Backtest', definition }));
          if (!checked.ok) {
            throw new ToolInputError(`Strategy is invalid: ${Object.entries(checked.errors).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
          }
          validatedDefinition = checked.draft.definition;
          resolvedName = checked.draft.name;
        }

        let preview: Awaited<ReturnType<BacktestGateway['preview']>>;
        try {
          preview = await backtest.gateway.preview(backtest.userId, {
            name: resolvedName,
            definition: validatedDefinition,
            candles,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
          throw new ToolInputError(code ? `Backtest failed (${code}): ${message}` : `Backtest failed: ${message}`);
        }
        backtestCount++;

        const trades = preview.trades.slice(-MAX_BACKTEST_TRADES_IN_BLOCK).map(t => ({
          side: t.side, entryTime: t.entryTime, exitTime: t.exitTime,
          entryPrice: t.entryPrice, exitPrice: t.exitPrice,
          quantity: t.quantity, profit: t.profit, profitPercent: t.profitPercent,
          fees: t.commission ?? t.fees, exitReason: t.exitReason,
        }));
        const m = preview.metrics;
        const result = {
          shownToUser: true,
          saved: false,
          engine: preview.engine,
          market: preview.market,
          range: preview.range,
          datasetCandles: preview.dataset.candles,
          metrics: {
            totalTrades: m.totalTrades,
            winRatePercent: m.winRatePercent,
            netProfit: m.netProfit,
            totalReturnPercent: m.totalReturnPercent,
            maxDrawdownPercent: m.maxDrawdownPercent,
            profitFactor: m.profitFactor,
            finalEquity: m.finalEquity,
            buyAndHoldReturnPercent: m.buyAndHoldReturnPercent,
          },
          warnings: preview.warnings.map(w => ({ code: w.code, message: w.message })),
          tradesShown: trades.length,
        };
        return {
          result,
          blocks: [{
            type: 'backtest_result' as const,
            data: {
              saved: false,
              market: preview.market,
              range: preview.range,
              metrics: preview.metrics as Record<string, unknown>,
              warnings: preview.warnings,
              trades,
              equityCurve: preview.equityCurve,
              engine: preview.engine,
            },
          }],
        };
      },
    )] : []),
    ...createResearchTools({ research, liveTesting, preview: backtest, drafts }),
    createNextStepsTool(market, {
      ...(research && {
        backtest: (id: string) => research.gateway.get(research.userId, id),
        experiment: (id: string) => research.gateway.getExperiment(research.userId, id),
      }),
      ...(liveTesting && { liveTest: (id: string) => liveTesting.gateway.get(liveTesting.userId, id) }),
    }),
    ...(webResearch ? [defineTool(
      'research_web',
      'Ask the web research sub-agent one specific question about news, filings, announcements, or other public-source facts that the market and portfolio tools do not have. It searches and reads public pages with the free research model, then returns a short answer and the URLs it actually read. Use at most once. Do not use it for live prices, indicators, or the user\'s holdings.',
      z.strictObject({ question: z.string().min(3).max(500).describe('One self-contained question, including the asset or event name') }),
      async ({ question }) => {
        if (webResearchCount >= 1) throw new ToolInputError('Web research was already used in this answer.');
        webResearchCount++;
        try {
          const brief = await webResearch.research(question);
          return {
            result: {
              ...brief,
              cost: 0,
              note: 'Cite only these sources. This is public-web research, not a live market quote.',
            },
          };
        } catch (error) {
          const message = error instanceof ToolInputError || error instanceof AiProviderError
            ? error.message
            : 'Web research is unavailable right now.';
          throw new ToolInputError(message);
        }
      },
    )] : []),
    ...(portfolio ? [defineTool(
      'get_my_holdings',
      'The holdings this user entered in their Portfolio table (asset, quantity, buy date, buy price), merged per asset and valued by the server at current prices: value, cost, profit/loss, share of the portfolio, days held and concentration. Use for any question about their portfolio, holdings or investments.',
      z.strictObject({}),
      async () => {
        const v = await portfolio.gateway.valuation(portfolio.userId);
        if (!v.lots) return { result: { holdings: 0, note: 'The user has not entered any holdings yet. Ask them to add rows in the Portfolio table (AI tab, Portfolio mode, "Edit holdings").' } };
        const shown = v.positions.slice(0, MAX_POSITIONS_IN_TOOL);
        const rest = v.positions.slice(MAX_POSITIONS_IN_TOOL);
        return {
          result: {
            currency: v.currency, asOf: v.asOf, tableUpdatedAt: v.updatedAt?.toISOString() ?? null, lots: v.lots,
            totals: v.totals, concentration: v.concentration, unpricedAssets: v.unpricedAssets,
            positions: shown,
            ...(rest.length && { otherPositions: { count: rest.length, value: Math.round(rest.reduce((s, p) => s + (p.value ?? 0), 0) * 100) / 100 } }),
            notes: [
              `Values, cost and P/L are in ${v.currency} and already computed: quote them, do not recompute.`,
              'buyPriceSource CLOSE_ON_BUY_DATE means the user gave no buy price, so the daily close on the buy date was used (an estimate).',
              'Unpriced assets are not listed on the exchange; only their quantity, dates and any entered buy price are known.',
            ],
          },
        };
      },
    )] : []),
  ];
}
