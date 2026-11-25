/** Compact, validated references to persisted runs; no scripts or raw datasets are rendered. */
export type AiResearchRun = {
  kind: 'backtest' | 'experiment' | 'paper'; id: string; status: string; title: string;
  market?: { exchange?: string; symbol?: string; timeframe?: string };
  range?: { start: number; end: number };
  summary?: Record<string, unknown>; message?: string;
};

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
export const isRunId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const statuses = { backtest: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'], experiment: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'], paper: ['CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED'] };

export function parseResearchRun(value: unknown): AiResearchRun | null {
  if (!object(value) || (value.kind !== 'backtest' && value.kind !== 'experiment' && value.kind !== 'paper') || !isRunId(value.id)) return null;
  const kind = value.kind, status = text(value.status, 20), title = text(value.title, 160);
  if (!status || !statuses[kind].includes(status) || !title) return null;
  const market = object(value.market) ? { exchange: text(value.market.exchange, 30), symbol: text(value.market.symbol, 128), timeframe: text(value.market.timeframe, 8) } : undefined;
  const range = object(value.range) && Number.isSafeInteger(value.range.start) && Number.isSafeInteger(value.range.end)
    && Number(value.range.start) >= 0 && Number(value.range.end) > Number(value.range.start) && Number(value.range.end) <= 8_640_000_000_000_000
    ? { start: Number(value.range.start), end: Number(value.range.end) } : undefined;
  // Keep only small scalar summaries. The current run endpoint supplies richer results when opened.
  const summary = object(value.summary) ? Object.fromEntries(Object.entries(value.summary).slice(0, 30).filter(([key, v]) => key.length <= 80 && (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 160)))) : undefined;
  return { kind, id: value.id, status, title, market, range, summary, message: text(value.message, 1500) };
}

export function shouldPollResearchRun(kind: AiResearchRun['kind'], status: string, closeStatus?: unknown) {
  return kind === 'paper' ? ['CREATED', 'RUNNING', 'PAUSED'].includes(status) || (status === 'STOPPED' && closeStatus === 'PENDING') : status === 'PENDING' || status === 'RUNNING';
}

export type LiveTestTermination = { reason: 'DEADLINE'; at: number; closeStatus: 'NOT_REQUESTED' | 'PENDING' | 'CLOSED' | 'NO_POSITION' | 'FAILED'; positionId?: string; message?: string };

export function liveTerminationDescription(termination?: LiveTestTermination | null) {
  if (!termination) return undefined;
  const outcome = {
    NOT_REQUESTED: 'Closing any remaining position was not requested.',
    PENDING: 'Requested virtual-position closure is pending.',
    CLOSED: 'The virtual position was closed.',
    NO_POSITION: 'There was no position to close.',
    FAILED: 'Automatic position closure failed. Review the position before taking another action.',
  }[termination.closeStatus];
  return `Deadline reached; the strategy stopped. ${outcome}${termination.message ? ` ${termination.message}` : ''}`;
}

export function mergeResearchRunRefs(previous: AiResearchRun[], incoming: AiResearchRun[]) {
  const runs = new Map(previous.map(run => [`${run.kind}:${run.id}`, run]));
  for (const run of incoming) runs.set(`${run.kind}:${run.id}`, run);
  return [...runs.values()].slice(-30);
}

export function researchRunLink(run: Pick<AiResearchRun, 'kind' | 'id'>) {
  if (run.kind === 'backtest') return { pathname: '/backtests/[id]' as const, params: { id: run.id } };
  if (run.kind === 'experiment') return { pathname: '/backtests/research' as const, params: { experimentId: run.id } };
  return { pathname: '/backtests/live/[id]' as const, params: { id: run.id } };
}

export function researchMetricPreview(summary?: Record<string, unknown>) {
  const labels = [
    ['totalReturnPercent', 'Return', '%'], ['netProfit', 'Net P/L', ''], ['maxDrawdownPercent', 'Drawdown at close', '%'],
    ['totalTrades', 'Trades', ''], ['finalEquity', 'Final equity', ''], ['testWindows', 'Unseen test windows', ''],
    ['recentSignals', 'Recent signals', ''],
  ];
  return labels.flatMap(([key, label, suffix]) => {
    const value = summary?.[key!];
    return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))
      ? [{ key: key!, label: label!, suffix: suffix!, value: value as string | number }] : [];
  }).slice(0, 4);
}
