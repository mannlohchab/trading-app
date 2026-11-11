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

export type ResponseBlock = MarkdownBlock | TickerBlock | MarketAnalysisBlock | MarketListBlock | ChartBlock | StrategyDraftBlock | DisclaimerBlock;

export const DISCLAIMER =
  'Educational information only, not investment advice. Strategies are for paper trading and research; past performance does not guarantee future results.';

/** Final block order: answer text first, then data cards, then drafts, then the disclaimer. */
export function assembleBlocks(text: string, dataBlocks: ResponseBlock[]): ResponseBlock[] {
  const rank: Record<ResponseBlock['type'], number> = { markdown: 0, ticker: 1, market_list: 1, chart: 1, market_analysis: 2, strategy_draft: 3, disclaimer: 4 };
  const blocks: ResponseBlock[] = [];
  if (text.trim()) blocks.push({ type: 'markdown', text: text.trim() });
  blocks.push(...dataBlocks.sort((a, b) => rank[a.type] - rank[b.type]));
  blocks.push({ type: 'disclaimer', text: DISCLAIMER });
  return blocks;
}
