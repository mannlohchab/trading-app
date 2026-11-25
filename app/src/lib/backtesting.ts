/** Pure contracts and form helpers shared by the backtesting screens and tests. */
export const BACKTEST_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
export type BacktestTimeframe = typeof BACKTEST_TIMEFRAMES[number];
export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type PositionSizing = { type: 'percent_of_equity' | 'cash' | 'fixed_quantity'; value: string };
export type BacktestSettings = { initialCapital: string; commissionPercent: string; slippageTicks: number; positionSizing: PositionSizing; execution?: { spreadTicks?: number; maxVolumeParticipationPercent?: string } };
export type RiskStatisticsInput = { periodsPerYear: number; annualRiskFreeRate?: number };
export type RiskStatistics = {
  sharpe: string | null; sortino: string | null; cagrPercent: string | null; annualizedVolatilityPercent: string | null;
  observations: number; reason?: string;
  assumptions?: { periodsPerYear: number; annualRiskFreeRate: number; sampling: string; cagr: string };
};
export type BacktestMetrics = {
  totalTrades: number; winningTrades: number; losingTrades: number; netProfit: string; unrealizedProfit: string;
  finalEquity: string; totalReturnPercent: string; maxDrawdownPercent: string; winRatePercent: string | null;
  profitFactor: string | null; totalCommission: string; buyAndHoldReturnPercent: string; exposurePercent: string;
  riskStatistics?: RiskStatistics;
  intrabarMaxDrawdownPercent?: string; intrabarDrawdownModel?: 'ohlc_path';
};
export type BacktestWarning = { code: string; message: string };
export type BacktestRun = {
  id: string; status: BacktestStatus;
  strategy: { id?: string; versionId: string; version?: number; name?: string };
  market: { exchange?: string; symbol?: string; timeframe: string };
  range: { start: number; end: number }; createdAt: string; startedAt: string | null; completedAt: string | null;
  error: { message: string; code: string | null } | null; summary: BacktestMetrics | null;
  settings?: BacktestSettings; warnings?: BacktestWarning[]; assumptions?: Record<string, string>;
  engine?: { name: string; version: string; revision?: string };
  symbol?: { quoteAsset: string; baseAsset: string; tickSize: string; lotSize: string };
  dataset?: { candles: number; expectedCandles: number; missingCandles: number; checksum: string; firstOpenTime: number; lastCloseTime: number; snapshotId?: string; warmupCandles?: number; warmupStartTime?: number } | null;
};
export type BacktestTrade = {
  id: string; side: string; entryTime: number; exitTime: number | null; entryPrice: string; exitPrice: string | null;
  quantity: string; profit: string | null; fees: string; exitReason: string | null;
};
export type EquityPoint = { time: number; equity: string };
export type StrategySummary = { id: string; name: string; description: string | null; latestVersion: number; status: string };
export type StrategyDetail = StrategySummary & {
  versionId: string;
  definition: { market: { exchange: string; symbol: string; timeframe: BacktestTimeframe }; direction: string; risk: { positionSizePercent: number }; [key: string]: unknown };
};
export type BacktestDraft = {
  start: string; end: string; timeframe: string; initialCapital: string; commissionPercent: string;
  slippageTicks: string; sizingType: PositionSizing['type']; sizingValue: string;
  spreadTicks?: string; maxVolumeParticipationPercent?: string;
  periodsPerYear?: string; annualRiskFreeRatePercent?: string;
};
export type CreateBacktestInput = {
  strategyId: string; strategyVersionId: string; market?: { timeframe: BacktestTimeframe };
  range?: { start?: string; end?: string }; settings: BacktestSettings;
  riskStatistics?: RiskStatisticsInput;
};
export const defaultBacktestDraft: BacktestDraft = {
  start: '', end: '', timeframe: '', initialCapital: '10000', commissionPercent: '0.1',
  slippageTicks: '1', sizingType: 'percent_of_equity', sizingValue: '10',
};

export const isActiveBacktest = (status: BacktestStatus) => status === 'PENDING' || status === 'RUNNING';

export function dateBoundary(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const timestamp = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(text);
  if (!dateOnly && !timestamp) throw new Error('Use YYYY-MM-DD or an ISO timestamp with Z or an explicit timezone offset.');
  const calendarDate = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== text.slice(0, 10)) throw new Error('Enter a valid calendar date.');
  const date = new Date(dateOnly ? `${text}T00:00:00.000Z` : text);
  if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid timestamp.');
  return date.toISOString();
}

function decimal(value: string, label: string, max: number, allowZero = false): string {
  const text = value.trim();
  if (!/^\d+(\.\d{1,12})?$/.test(text) || !Number.isFinite(Number(text)) || Number(text) > max || (allowZero ? Number(text) < 0 : Number(text) <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'zero or more' : 'greater than zero'} and at most ${max}.`);
  }
  return text;
}

export function prepareRiskStatistics(periodsText?: string, ratePercentText?: string): RiskStatisticsInput | undefined {
  const periods = periodsText?.trim(), rate = ratePercentText?.trim();
  if (!periods && !rate) return undefined;
  if (!periods || !/^\d+(\.\d+)?$/.test(periods) || Number(periods) <= 0 || Number(periods) > 1_000_000_000) throw new Error('Annual observations must be greater than zero and at most 1000000000.');
  if (rate && (!/^-?\d+(\.\d+)?$/.test(rate) || !Number.isFinite(Number(rate)) || Number(rate) <= -100 || Number(rate) > 1000)) throw new Error('Annual risk-free rate must be greater than -100% and at most 1000%.');
  return { periodsPerYear: Number(periods), annualRiskFreeRate: rate ? Number(rate) / 100 : 0 };
}

/** Keep decimal input as strings; reject impossible dates instead of Date's silent rollover. */
export function prepareBacktest(draft: BacktestDraft, strategy: Pick<StrategyDetail, 'id' | 'versionId'>, now = Date.now()): CreateBacktestInput {
  if (!strategy.id || !strategy.versionId) throw new Error('Select a saved strategy first.');
  const start = dateBoundary(draft.start), end = dateBoundary(draft.end);
  if (start && Date.parse(start) >= now) throw new Error('The start date must be in the past.');
  if (end && Date.parse(end) > now) throw new Error('The end date cannot be in the future.');
  if (start && end && Date.parse(end) <= Date.parse(start)) throw new Error('The end date must be after the start date.');
  if (draft.timeframe && !(BACKTEST_TIMEFRAMES as readonly string[]).includes(draft.timeframe)) throw new Error('Select a supported timeframe.');
  const slippage = draft.slippageTicks.trim();
  if (!/^\d+$/.test(slippage) || Number(slippage) > 1000) throw new Error('Slippage must be a whole number from 0 to 1000 ticks.');
  const spread = draft.spreadTicks?.trim(), participation = draft.maxVolumeParticipationPercent?.trim();
  if (spread && (!/^\d+$/.test(spread) || Number(spread) > 10000)) throw new Error('Spread must be a whole number from 0 to 10000 ticks.');
  const riskStatistics = prepareRiskStatistics(draft.periodsPerYear, draft.annualRiskFreeRatePercent);
  return {
    strategyId: strategy.id, strategyVersionId: strategy.versionId,
    ...(draft.timeframe ? { market: { timeframe: draft.timeframe as BacktestTimeframe } } : {}),
    ...(start || end ? { range: { ...(start ? { start } : {}), ...(end ? { end } : {}) } } : {}),
    ...(riskStatistics ? { riskStatistics } : {}),
    settings: {
      initialCapital: decimal(draft.initialCapital, 'Initial capital', 1_000_000_000),
      commissionPercent: decimal(draft.commissionPercent, 'Commission', 5, true),
      slippageTicks: Number(slippage),
      positionSizing: { type: draft.sizingType, value: decimal(draft.sizingValue, 'Position size', draft.sizingType === 'percent_of_equity' ? 100 : 1_000_000_000) },
      ...(spread || participation ? { execution: { ...(spread ? { spreadTicks: Number(spread) } : {}), ...(participation ? { maxVolumeParticipationPercent: decimal(participation, 'Volume participation', 100) } : {}) } } : {}),
    },
  };
}

/** Comparisons remain visible but explicitly identify different experimental conditions. */
export function comparisonNotes(runs: BacktestRun[]): string[] {
  if (runs.length < 2) return [];
  const first = runs[0]!;
  const notes: string[] = [];
  if (runs.some(r => r.market.exchange !== first.market.exchange || r.market.symbol !== first.market.symbol)) notes.push('Different instruments: profits may use different currencies and market exposures.');
  if (runs.some(r => r.range.start !== first.range.start || r.range.end !== first.range.end || r.market.timeframe !== first.market.timeframe)) notes.push('Different periods or timeframes: returns are not directly comparable.');
  if (runs.some(r => r.settings?.initialCapital !== first.settings?.initialCapital)) notes.push('Different initial capital: compare percentage returns alongside absolute profit.');
  if (runs.some(r => r.settings?.commissionPercent !== first.settings?.commissionPercent || r.settings?.slippageTicks !== first.settings?.slippageTicks)) notes.push('Different transaction costs: the runs use different fee or slippage assumptions.');
  if (runs.some(r => r.settings?.execution?.spreadTicks !== first.settings?.execution?.spreadTicks || r.settings?.execution?.maxVolumeParticipationPercent !== first.settings?.execution?.maxVolumeParticipationPercent)) notes.push('Different spread or liquidity assumptions were used.');
  if (runs.some(r => r.settings?.positionSizing.type !== first.settings?.positionSizing.type || r.settings?.positionSizing.value !== first.settings?.positionSizing.value)) notes.push('Different position sizing: the runs take different amounts of risk.');
  if (runs.some(r => r.dataset?.checksum && first.dataset?.checksum && r.dataset.checksum !== first.dataset.checksum)) notes.push('Different historical datasets were used.');
  return notes;
}

export function metricText(value: string | number | null | undefined, suffix = '', digits = 2): string {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix}`;
}

export function equitySegments(points: EquityPoint[], width: number, height = 140) {
  const valid = points.filter(p => Number.isFinite(p.time) && p.equity !== '' && Number.isFinite(Number(p.equity)));
  if (valid.length < 2 || width <= 0) return [];
  let ordered = [...valid].sort((a, b) => a.time - b.time);
  // Quote portfolios can contain many observations. Bound native views while retaining
  // the min/max in each time-ordered bucket, including sharp drawdowns.
  if (ordered.length > 240) {
    const sampled = [ordered[0]!], size = (ordered.length - 2) / 119;
    for (let bucket = 0; bucket < 119; bucket++) {
      const slice = ordered.slice(1 + Math.floor(bucket * size), 1 + Math.floor((bucket + 1) * size));
      if (!slice.length) continue;
      let lo = slice[0]!, hi = slice[0]!;
      for (const point of slice) { if (Number(point.equity) < Number(lo.equity)) lo = point; if (Number(point.equity) > Number(hi.equity)) hi = point; }
      sampled.push(...(lo === hi ? [lo] : lo.time <= hi.time ? [lo, hi] : [hi, lo]));
    }
    sampled.push(ordered.at(-1)!); ordered = sampled;
  }
  const values = ordered.map(p => Number(p.equity));
  const min = Math.min(...values), max = Math.max(...values), range = max - min;
  const start = ordered[0]!.time, duration = ordered.at(-1)!.time - start;
  const xy = ordered.map((p, i) => ({ x: duration ? (p.time - start) / duration * width : i / (ordered.length - 1) * width, y: range ? 8 + (max - Number(p.equity)) / range * (height - 16) : height / 2 }));
  return xy.slice(1).map((p, i) => {
    const a = xy[i]!, length = Math.hypot(p.x - a.x, p.y - a.y);
    return { left: (a.x + p.x - length) / 2, top: (a.y + p.y) / 2 - 1, width: length, angle: Math.atan2(p.y - a.y, p.x - a.x) };
  });
}
