// Structured assistant responses. Data blocks are built by the server from tool results, never
// from model text, so cards always show real observed values.

export type MarkdownBlock = { type: 'markdown'; text: string };
export type TickerBlock = { type: 'ticker'; data: Record<string, unknown> };
export type MarketAnalysisBlock = { type: 'market_analysis'; data: Record<string, unknown> };
export type MarketListBlock = { type: 'market_list'; title: string; data: Record<string, unknown>[] };
export type StrategyDraftBlock = {
  type: 'strategy_draft';
  /** Stable id within the message; used to save the draft. */
  draftId: string;
  draft: Record<string, unknown>;
  /** Plain-language rules for display. */
  summary: string[];
  /** Set once saved. */
  savedStrategyId?: string;
};
import type { ChartData } from './chart';

export type ChartBlock = { type: 'chart'; data: ChartData };
export type DisclaimerBlock = { type: 'disclaimer'; text: string };

/** Persisted research or live virtual strategy; the client refreshes status by owner-scoped id. */
export type ResearchRunBlock = {
  type: 'research_run';
  data: {
    kind: 'backtest' | 'experiment' | 'paper'; id: string; status: string; title: string;
    market?: { exchange?: string; symbol?: string; timeframe?: string };
    range?: { start: number; end: number };
    summary?: Record<string, unknown>;
    message?: string;
  };
};

/** Engine-backed backtest summary for in-chat cards (preview or completed job). */
export type BacktestResultBlock = {
  type: 'backtest_result';
  data: {
    /** Present when a persisted job was created; absent for unsaved previews. */
    backtestId?: string;
    saved: boolean;
    market: { exchange: string; symbol: string; timeframe: string };
    range: { start: number; end: number };
    metrics: Record<string, unknown>;
    warnings: { code: string; message: string }[];
    trades: Record<string, unknown>[];
    equityCurve: { time: number; equity: string }[];
    engine: { name: string; version: string; revision?: string };
  };
};

/** Screens a suggested action can open. Each maps to one app route (app/src/lib/aiActions.ts). */
export const ACTION_SCREENS = [
  'markets', 'market', 'instrument', 'backtests', 'backtest_result', 'research', 'live_test',
  'holdings', 'paper_portfolio', 'settings', 'calendar', 'community', 'compose_post', 'news',
] as const;
export type ActionScreen = (typeof ACTION_SCREENS)[number];
export type ActionTarget = { screen: ActionScreen; symbol?: string; timeframe?: string; id?: string };

/** A button under the answer: open a screen, or send a follow-up question as the user. */
export type SuggestedAction =
  | { kind: 'open'; label: string; target: ActionTarget }
  | { kind: 'ask'; label: string; prompt: string };
export type ActionsBlock = { type: 'actions'; items: SuggestedAction[] };

export type ResponseBlock =
  | ActionsBlock
  | MarkdownBlock
  | TickerBlock
  | MarketAnalysisBlock
  | MarketListBlock
  | ChartBlock
  | StrategyDraftBlock
  | BacktestResultBlock
  | ResearchRunBlock
  | DisclaimerBlock;

export const DISCLAIMER =
  'Educational information only, not investment advice. Strategies are for paper trading and research; past performance does not guarantee future results.';

/** Final block order: answer text first, then data cards, then drafts/backtests, then next steps, then the disclaimer. */
export function assembleBlocks(text: string, dataBlocks: ResponseBlock[]): ResponseBlock[] {
  const rank: Record<ResponseBlock['type'], number> = {
    markdown: 0, ticker: 1, market_list: 1, chart: 1, market_analysis: 2,
    strategy_draft: 3, backtest_result: 3, research_run: 3, actions: 4, disclaimer: 5,
  };
  const blocks: ResponseBlock[] = [];
  if (text.trim()) blocks.push({ type: 'markdown', text: text.trim() });
  blocks.push(...dataBlocks.sort((a, b) => rank[a.type] - rank[b.type]));
  blocks.push({ type: 'disclaimer', text: DISCLAIMER });
  return blocks;
}
