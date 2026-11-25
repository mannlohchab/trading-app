// Parsers for structured AI response blocks (server-built, never from model text).
import { chartsFromBlocks, parseChartBlock, type AiChart } from '@/lib/aiCharts';
import { mergeResearchRunRefs, parseResearchRun, type AiResearchRun } from './aiResearchRun';
import { parseActions, type AiAction } from './aiActions';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 80) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export type AiTicker = {
  exchange: string;
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice?: string;
  lowPrice?: string;
  quoteVolume?: string;
};

export type AiMarketAnalysis = {
  exchange: string;
  symbol: string;
  timeframe: string;
  lastClose?: number;
  changePercent?: number;
  trend?: string;
  rsi14?: number;
  rsiState?: string;
  support?: number;
  resistance?: number;
  raw: Record<string, unknown>;
};

export type AiMarketList = { title: string; tickers: AiTicker[] };

export type AiStrategyDraft = {
  draftId: string;
  name?: string;
  summary: string[];
  savedStrategyId?: string;
  draft: Record<string, unknown>;
};

export type AiBacktestResult = {
  backtestId?: string;
  saved: boolean;
  market: { exchange: string; symbol: string; timeframe: string };
  range: { start: number; end: number };
  metrics: {
    totalTrades?: number;
    winRatePercent?: string | number | null;
    netProfit?: string | number;
    totalReturnPercent?: string | number;
    maxDrawdownPercent?: string | number;
    profitFactor?: string | number | null;
    finalEquity?: string | number;
    buyAndHoldReturnPercent?: string | number;
  };
  warnings: { code: string; message: string }[];
  trades: {
    side?: string;
    entryTime?: number;
    exitTime?: number;
    entryPrice?: string;
    exitPrice?: string;
    profit?: string;
    profitPercent?: string;
    exitReason?: string;
  }[];
  equityCurve: { time: number; equity: string }[];
  engine: { name: string; version?: string };
};

export type AiParsedBlocks = {
  charts: AiChart[];
  tickers: AiTicker[];
  marketLists: AiMarketList[];
  analyses: AiMarketAnalysis[];
  drafts: AiStrategyDraft[];
  backtests: AiBacktestResult[];
  researchRuns: AiResearchRun[];
  /** Next-step buttons; the latest `actions` block wins. */
  actions: AiAction[];
};

function parseTicker(data: unknown): AiTicker | null {
  if (!isObj(data)) return null;
  const symbol = str(data.symbol, 30), exchange = str(data.exchange, 20);
  const lastPrice = str(data.lastPrice, 40), priceChangePercent = str(data.priceChangePercent, 20);
  if (!symbol || !exchange || !lastPrice || priceChangePercent === undefined) return null;
  return {
    exchange, symbol, lastPrice, priceChangePercent,
    highPrice: str(data.highPrice, 40), lowPrice: str(data.lowPrice, 40), quoteVolume: str(data.quoteVolume, 40),
  };
}

function parseAnalysis(data: unknown): AiMarketAnalysis | null {
  if (!isObj(data)) return null;
  const symbol = str(data.symbol, 30), exchange = str(data.exchange, 20), timeframe = str(data.timeframe, 5);
  if (!symbol || !exchange || !timeframe) return null;
  return {
    exchange, symbol, timeframe,
    lastClose: num(data.lastClose), changePercent: num(data.changePercent),
    trend: str(data.trend, 40), rsi14: num(data.rsi14), rsiState: str(data.rsiState, 40),
    support: num(data.support), resistance: num(data.resistance), raw: data,
  };
}

function parseDraft(block: Record<string, unknown>): AiStrategyDraft | null {
  const draftId = str(block.draftId, 40);
  if (!draftId || !Array.isArray(block.summary)) return null;
  const summary = block.summary.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 12);
  const draft = isObj(block.draft) ? block.draft : {};
  const name = str((draft as { name?: unknown }).name, 80);
  return {
    draftId, name, summary, draft,
    savedStrategyId: str(block.savedStrategyId, 80),
  };
}

function parseBacktest(data: unknown): AiBacktestResult | null {
  if (!isObj(data) || !isObj(data.market) || !isObj(data.metrics) || !isObj(data.engine)) return null;
  const symbol = str(data.market.symbol, 30), exchange = str(data.market.exchange, 20), timeframe = str(data.market.timeframe, 5);
  if (!symbol || !exchange || !timeframe) return null;
  const range = isObj(data.range) ? data.range : {};
  const start = num(range.start) ?? 0, end = num(range.end) ?? 0;
  const equityCurve = (Array.isArray(data.equityCurve) ? data.equityCurve : []).flatMap((p: unknown) => {
    if (!isObj(p) || !num(p.time) || typeof p.equity !== 'string') return [];
    return [{ time: p.time as number, equity: p.equity }];
  });
  const trades = (Array.isArray(data.trades) ? data.trades : []).flatMap((t: unknown) => (isObj(t) ? [t] : [])).slice(0, 40).map(t => ({
    side: str(t.side, 10), entryTime: num(t.entryTime), exitTime: num(t.exitTime),
    entryPrice: str(t.entryPrice, 40), exitPrice: str(t.exitPrice, 40),
    profit: str(t.profit, 40), profitPercent: str(t.profitPercent, 40), exitReason: str(t.exitReason, 80),
  }));
  const warnings = (Array.isArray(data.warnings) ? data.warnings : []).flatMap((w: unknown) => {
    if (!isObj(w) || !str(w.code, 60) || !str(w.message, 400)) return [];
    return [{ code: w.code as string, message: w.message as string }];
  });
  const m = data.metrics;
  return {
    backtestId: str(data.backtestId, 80),
    saved: data.saved === true,
    market: { exchange, symbol, timeframe },
    range: { start, end },
    metrics: {
      totalTrades: num(m.totalTrades),
      winRatePercent: (m.winRatePercent as string | number | null | undefined) ?? null,
      netProfit: m.netProfit as string | number | undefined,
      totalReturnPercent: m.totalReturnPercent as string | number | undefined,
      maxDrawdownPercent: m.maxDrawdownPercent as string | number | undefined,
      profitFactor: (m.profitFactor as string | number | null | undefined) ?? null,
      finalEquity: m.finalEquity as string | number | undefined,
      buyAndHoldReturnPercent: m.buyAndHoldReturnPercent as string | number | undefined,
    },
    warnings, trades, equityCurve,
    engine: { name: str(data.engine.name, 40) ?? 'engine', version: str(data.engine.version, 40) },
  };
}

/** Parse all structured cards from a list of server blocks. */
export function parseAiBlocks(blocks: unknown): AiParsedBlocks {
  const empty: AiParsedBlocks = { charts: [], tickers: [], marketLists: [], analyses: [], drafts: [], backtests: [], researchRuns: [], actions: [] };
  if (!Array.isArray(blocks)) return empty;
  for (const raw of blocks) {
    if (!isObj(raw) || typeof raw.type !== 'string') continue;
    switch (raw.type) {
      case 'chart': {
        const chart = parseChartBlock(raw);
        if (chart) empty.charts.push(chart);
        break;
      }
      case 'ticker': {
        const t = parseTicker(raw.data);
        if (t) empty.tickers.push(t);
        break;
      }
      case 'market_list': {
        const title = str(raw.title, 120) ?? 'Markets';
        const tickers = (Array.isArray(raw.data) ? raw.data : []).map(parseTicker).filter((t): t is AiTicker => !!t);
        if (tickers.length) empty.marketLists.push({ title, tickers });
        break;
      }
      case 'market_analysis': {
        const a = parseAnalysis(raw.data);
        if (a) empty.analyses.push(a);
        break;
      }
      case 'strategy_draft': {
        const d = parseDraft(raw);
        if (d) empty.drafts.push(d);
        break;
      }
      case 'backtest_result': {
        const b = parseBacktest(raw.data);
        if (b) empty.backtests.push(b);
        break;
      }
      case 'research_run': {
        const run = parseResearchRun(raw.data);
        if (run) empty.researchRuns = mergeResearchRunRefs(empty.researchRuns, [run]);
        break;
      }
      case 'actions': {
        const actions = parseActions(raw.items);
        if (actions.length) empty.actions = actions;
        break;
      }
      default:
        break;
    }
  }
  // Prefer the dedicated chart parser list when only charts are needed elsewhere.
  if (!empty.charts.length) empty.charts = chartsFromBlocks(blocks);
  return empty;
}
