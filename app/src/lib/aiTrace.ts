// What the assistant did while answering, shown as a trace above its reply: one step per tool call.
// Pure helpers; the backend streams `status` (stage "tool") and `tool_result` events, and saves the
// same calls in each reply's `metadata.toolCalls`.

export type StepStatus = 'running' | 'done' | 'error';
export type ToolStep = {
  id: string;
  tool: string;
  args?: unknown;
  status: StepStatus;
  durationMs?: number;
  error?: string;
};

type Args = Record<string, unknown>;
const asArgs = (args: unknown): Args => (args && typeof args === 'object' && !Array.isArray(args) ? args as Args : {});
const text = (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase() : '');
const list = (values: unknown, max = 3) => {
  const items = Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string').map(v => v.toUpperCase()) : [];
  return items.length > max ? `${items.slice(0, max).join(', ')} +${items.length - max}` : items.join(', ');
};
const MOVERS: Record<string, string> = { gainers: 'top gainers', losers: 'top losers', volume: 'most traded pairs' };

/** "Checking BTCUSDT price" while running, "Checked BTCUSDT price" once done. */
export function stepTitle(step: Pick<ToolStep, 'tool' | 'args' | 'status'>): string {
  const a = asArgs(step.args);
  const running = step.status === 'running';
  const verb = (doing: string, did: string) => (running ? doing : did);
  switch (step.tool) {
    case 'get_my_holdings': return `${verb('Reading', 'Read')} your holdings`;
    case 'get_tickers': {
      const symbols = list(a.symbols);
      return `${verb('Checking', 'Checked')} ${symbols ? `${symbols} ` : ''}${Array.isArray(a.symbols) && a.symbols.length > 1 ? 'prices' : 'price'}`;
    }
    case 'get_top_movers': return `${verb('Finding', 'Found')} ${MOVERS[String(a.sort)] ?? 'top movers'}`;
    case 'analyze_market': return `${verb('Analysing', 'Analysed')} ${text(a.symbol) || 'the market'}${a.timeframe ? ` (${String(a.timeframe)})` : ''}`;
    case 'show_chart': return `${verb('Drawing', 'Drew')} ${text(a.symbol) ? `${text(a.symbol)} ` : ''}chart`;
    case 'draft_strategy': return `${verb('Drafting', 'Drafted')} a strategy`;
    case 'run_backtest': {
      const symbol = text(a.symbol) || (typeof a.draftId === 'string' ? String(a.draftId) : '');
      return `${verb('Backtesting', 'Backtested')} ${symbol || 'strategy'}`;
    }
    case 'search_symbols': return `${verb('Searching', 'Searched')} for “${typeof a.query === 'string' ? a.query.trim() : '…'}”`;
    default: return `${verb('Using', 'Used')} ${step.tool.replace(/_/g, ' ')}`;
  }
}

const LABELS: Record<string, string> = {
  symbol: 'Pair', symbols: 'Pairs', timeframe: 'Timeframe', candles: 'Candles', chartType: 'Chart', overlays: 'Lines',
  sort: 'Sort', quoteAsset: 'Quote', limit: 'Count', query: 'Search', name: 'Name', draftId: 'Draft',
};

/** The call's inputs as label/value rows (never raw JSON). Nested objects are left out. */
export function stepDetails(step: Pick<ToolStep, 'tool' | 'args'>): { label: string; value: string }[] {
  const a = asArgs(step.args);
  const rows: { label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(a)) {
    const label = LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') rows.push({ label, value: String(value) });
    else if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) {
      if (value.length) rows.push({ label, value: value.join(', ') });
    }
  }
  return rows.slice(0, 6);
}

/** 420 → "0.4s", 2300 → "2.3s", 65000 → "1m 5s". */
export function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60_000) return `${(Math.max(ms, 100) / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Steps for a saved reply, from `metadata.toolCalls`. */
export function stepsFromToolCalls(toolCalls: unknown, messageId: string): ToolStep[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.flatMap((call, index): ToolStep[] => {
    if (!call || typeof call !== 'object' || typeof (call as Args).name !== 'string') return [];
    const c = call as Args;
    return [{
      id: `${messageId}-tool-${index}`,
      tool: c.name as string,
      args: c.arguments,
      status: c.ok === false ? 'error' : 'done',
      ...(typeof c.durationMs === 'number' && { durationMs: c.durationMs }),
      ...(typeof c.error === 'string' && { error: c.error }),
    }];
  });
}

/** Applies a streamed event to the steps: a tool starting, or a tool finishing. */
export function applyStepEvent(steps: ToolStep[], event: { type: string; stage?: string; tool?: string; callId?: string; arguments?: unknown; ok?: boolean; durationMs?: number; error?: string }): ToolStep[] {
  if (event.type === 'status' && event.stage === 'tool' && event.tool) {
    const id = event.callId ?? `step-${steps.length}`;
    if (steps.some(s => s.id === id)) return steps;
    return [...steps, { id, tool: event.tool, args: event.arguments, status: 'running' }];
  }
  if (event.type === 'tool_result' && event.callId) {
    return steps.map(s => s.id === event.callId
      ? { ...s, status: event.ok === false ? 'error' : 'done', durationMs: event.durationMs, ...(event.error && { error: event.error }) }
      : s);
  }
  return steps;
}

/**
 * When a reply ends nothing is left spinning. Unfinished steps become `done` when the reply completed
 * (an older server sends no `tool_result`), or `error` when it was stopped or failed.
 */
export const settleSteps = (steps: ToolStep[] | undefined, as: 'done' | 'error' = 'done') =>
  steps?.map(s => (s.status === 'running' ? { ...s, status: as } : s));
