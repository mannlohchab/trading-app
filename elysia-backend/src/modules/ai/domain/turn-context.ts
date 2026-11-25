// What the assistant knows about the user and their screen when a turn starts. Pure: the snapshot
// is gathered elsewhere (infrastructure/user-snapshot) and the client context is validated at the
// HTTP edge. Everything rendered here is data for the model, never instructions.

/** Screens the app can say the assistant was opened from. */
export const APP_SCREENS = [
  'home', 'markets', 'market', 'instrument', 'stock', 'ai', 'portfolio_holdings',
  'backtests', 'backtest_result', 'research', 'live_test',
  'community', 'news', 'calendar', 'profile',
] as const;
export type AppScreen = (typeof APP_SCREENS)[number];

export const ASSISTANT_MODES = ['chat', 'analysis', 'portfolio'] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

/** Sent by the app with each message. */
export type ClientTurnContext = {
  mode?: AssistantMode;
  /** The pair selected in Market mode, e.g. BTCUSDT. */
  symbol?: string;
  exchange?: string;
  /** The screen the user came from when they opened the assistant. */
  from?: AppScreen;
};

/** Each section is omitted when its source is unavailable or failed; absence is not "none". */
export type UserSnapshot = {
  strategies?: { total: number; recent: { name: string }[] };
  backtests?: { recent: { strategy: string | null; symbol: string | null; timeframe: string | null; status: string; totalReturnPercent: number | null }[] };
  liveTests?: { active: { strategy: string | null; symbol: string | null; timeframe: string | null; status: string }[] };
  holdings?: { lots: number; assets: string[] };
  /** Facts saved with the remember tool, oldest first. */
  memories?: { id: string; content: string }[];
};

export const SNAPSHOT_LIMITS = { strategies: 3, backtests: 3, liveTests: 3, assets: 8 } as const;

const SCREEN_LABEL: Record<AppScreen, string> = {
  home: 'Home', markets: 'Markets tab', market: 'Market tab', instrument: 'a crypto pair page', stock: 'a stock page',
  ai: 'the AI tab', portfolio_holdings: 'the Portfolio holdings table', backtests: 'the Backtests workspace',
  backtest_result: 'a backtest result', research: 'the Research screen', live_test: 'a live forward test',
  community: 'Community', news: 'News', calendar: 'Calendar', profile: 'Profile and settings',
};

/** User-entered names: one line, bounded, quoted, so they cannot pose as prompt structure. */
const name = (value: string | null | undefined, max = 60) => {
  const clean = (value ?? '').replace(/[\r\n\t"`]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? `"${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}"` : 'an unnamed strategy';
};
const market = (symbol: string | null, timeframe: string | null) => [symbol, timeframe].filter(Boolean).join(' ') || 'unknown market';
const pct = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}%`;

/** The "This user right now" section of the system prompt. */
export function renderTurnContext(snapshot: UserSnapshot, client: ClientTurnContext = {}): string[] {
  const lines: string[] = [];

  if (client.mode === 'analysis' && client.symbol) {
    lines.push(`- Assistant mode: Market analysis of ${client.symbol}${client.exchange ? ` on ${client.exchange}` : ''}. A question that names no pair is about this pair.`);
  } else if (client.mode === 'portfolio') {
    lines.push('- Assistant mode: Portfolio. Questions are about the holdings in their Portfolio table unless they say otherwise.');
  }
  if (client.from && client.from !== 'ai') lines.push(`- They opened the assistant from ${SCREEN_LABEL[client.from]}.`);

  const { strategies, backtests, liveTests, holdings } = snapshot;
  if (strategies) {
    lines.push(strategies.total
      ? `- Saved strategies: ${strategies.total} (most recent: ${strategies.recent.map(s => name(s.name)).join(', ')}).`
      : '- Saved strategies: none yet.');
  }
  if (backtests) {
    lines.push(backtests.recent.length
      ? `- Recent backtests: ${backtests.recent.map(b => `${name(b.strategy)} on ${market(b.symbol, b.timeframe)}, ${b.status.toLowerCase()}${b.totalReturnPercent !== null ? `, return ${pct(b.totalReturnPercent)}` : ''}`).join('; ')}.`
      : '- Backtests: none run yet.');
  }
  if (liveTests) {
    lines.push(liveTests.active.length
      ? `- Live forward tests not stopped: ${liveTests.active.map(l => `${name(l.strategy)} on ${market(l.symbol, l.timeframe)} (${l.status.toLowerCase()})`).join('; ')}.`
      : '- Live forward tests: none running.');
  }
  if (holdings) {
    lines.push(holdings.lots
      ? `- Portfolio table: ${holdings.lots} ${holdings.lots === 1 ? 'row' : 'rows'} across ${holdings.assets.join(', ')}. Call get_my_holdings for values and P/L.`
      : '- Portfolio table: empty.');
  }
  const isNew = strategies?.total === 0 && backtests?.recent.length === 0 && liveTests?.active.length === 0 && holdings?.lots === 0;
  if (isNew) lines.push('- They have not used the research features yet: when it fits, suggest one concrete first step.');
  if (snapshot.memories) {
    lines.push(snapshot.memories.length
      ? '- What you remember (they told you earlier; use it quietly, keep it current with remember / forget_memory):'
      : '- What you remember: nothing yet. Save lasting preferences or goals they mention with remember.');
    // Stored text was checked when saved; flatten again so a row can never pose as prompt structure.
    for (const m of snapshot.memories) lines.push(`  - [${m.id}] ${m.content.replace(/[\r\n\t]+/g, ' ')}`);
  }
  return lines;
}
