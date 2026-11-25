import type { BacktestMetrics, BacktestSettings, BacktestStatus, BacktestTimeframe, EquityPoint, RiskStatisticsInput, StrategyDetail } from './backtesting';

export type ResearchDataset = {
  id: string; name: string; checksum: string; createdAt: string; candleCount: number; quoteCount: number;
  instruments: { id: string; symbol: string; exchange: string; assetClass: string }[];
  ranges: { instrumentId: string; timeframe: string; start: number; end: number; candles: number }[];
};
export type ResearchMetrics = BacktestMetrics & { equityCurve?: EquityPoint[]; range?: { start: number; end: number }; settings?: BacktestSettings; executionAssumptions?: string[] };
export type ResearchObjective = 'total_return' | 'min_drawdown' | 'sharpe' | 'sortino';
export type ResearchEvaluation = { score: number; rankingScore?: number; objectiveValue?: number; metrics: ResearchMetrics };
export type ResearchResult = {
  kind?: 'single' | 'walk_forward'; metrics?: ResearchMetrics; assumptions?: string[] | Record<string, string>; warnings?: string[];
  objective?: ResearchObjective; selectionObjective?: string;
  datasetChecksum?: string;
  windows?: { selectedCandidate: number; trainRange: { start: number; end: number }; testRange: { start: number; end: number }; outOfSample: ResearchEvaluation }[];
  sensitivity?: { minimumScore: number; maximumScore: number; medianScore: number; warnings: string[]; results: (ResearchEvaluation & { index: number })[] };
  status?: 'COMPLETED' | 'MARGIN_BREACH'; finalEquity?: string; netProfit?: string; totalFees?: string; cash?: string; maxDrawdown?: string;
  equityCurve?: EquityPoint[];
  orders?: { id: string; time: number; status: string; reason?: string; fees: string; netDebit: string; fills: { instrumentId: string; side: string; quantity: string; price: string; fee: string }[] }[];
};
export type ResearchExperiment = { id: string; kind: 'single' | 'walk_forward' | 'options'; datasetId: string; status: BacktestStatus; createdAt: string; error?: string | null; result?: ResearchResult | null };
export type ResearchInput = {
  kind: 'single' | 'walk_forward'; datasetId: string; instrumentId: string; timeframe: BacktestTimeframe;
  range: { start: number; end: number }; definitions: StrategyDetail['definition'][]; settings?: Partial<BacktestSettings>;
  riskStatistics?: RiskStatisticsInput;
  objective?: ResearchObjective;
  walkForward?: { trainBars: number; testBars: number; embargoBars: number; stepBars?: number; anchored?: boolean };
};

export function researchObjectiveInfo(objective: ResearchObjective = 'total_return') {
  return {
    total_return: { label: 'Total return', suffix: '%', selection: 'Highest training return' },
    min_drawdown: { label: 'Drawdown at close', suffix: '%', selection: 'Lowest training drawdown at candle close' },
    sharpe: { label: 'Sharpe ratio', suffix: '', selection: 'Highest training Sharpe ratio' },
    sortino: { label: 'Sortino ratio', suffix: '', selection: 'Highest training Sortino ratio' },
  }[objective];
}

/** A drawdown ranking score is negative utility, never a negative drawdown or a return. */
export function researchObjectiveValue(evaluation: Pick<ResearchEvaluation, 'score' | 'objectiveValue'> & { metrics?: Partial<ResearchMetrics> }, objective: ResearchObjective = 'total_return'): string | number | null {
  const actual = evaluation.objectiveValue;
  if (typeof actual === 'number' && Number.isFinite(actual)) return actual;
  const metric = objective === 'total_return' ? evaluation.metrics?.totalReturnPercent : objective === 'min_drawdown' ? evaluation.metrics?.maxDrawdownPercent : evaluation.metrics?.riskStatistics?.[objective];
  if ((typeof metric === 'string' && metric.trim() && Number.isFinite(Number(metric))) || (typeof metric === 'number' && Number.isFinite(metric))) return metric;
  // The original schema had return as its only objective; its score is a safe compatibility fallback.
  return objective === 'total_return' && Number.isFinite(evaluation.score) ? evaluation.score : null;
}

export function researchInteger(text: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(text.trim()) || Number(text) < min || Number(text) > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return Number(text);
}

export function parseDatasetDocument(text: string): unknown {
  if (!text.trim()) throw new Error('Paste the historical dataset document first.');
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('The paste importer accepts at most 2 MB. Import larger datasets through the authenticated dataset endpoint.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('The dataset is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('A dataset must be a JSON object.');
  return parsed;
}
