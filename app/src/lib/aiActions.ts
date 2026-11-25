// Next-step buttons from the assistant (`actions` blocks). The server checks every target; the app
// still maps only known screens to routes, so an unknown screen from a newer server is dropped.
import type { Href } from 'expo-router';

export type AiActionTarget = { screen: string; symbol?: string; timeframe?: string; id?: string };
export type AiAction =
  | { kind: 'open'; label: string; href: Href }
  | { kind: 'ask'; label: string; prompt: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : undefined);
const SYMBOL = /^[A-Z0-9][A-Z0-9/._-]{1,29}$/;
const ID = /^[0-9a-f-]{36}$/i;

/** Route for a server action target, or null when this app version doesn't know the screen. */
export function actionHref(target: AiActionTarget): Href | null {
  const { screen, symbol, timeframe, id } = target;
  switch (screen) {
    case 'markets': return '/(tabs)/markets';
    case 'market': return '/(tabs)/market';
    case 'instrument':
      return symbol && SYMBOL.test(symbol)
        ? { pathname: '/instrument/[symbol]', params: { symbol, exchange: 'BINANCE', ...(timeframe && { timeframe }) } }
        : null;
    case 'backtests': return '/backtests';
    case 'backtest_result': return id && ID.test(id) ? { pathname: '/backtests/[id]', params: { id } } : null;
    case 'research': return id && ID.test(id) ? { pathname: '/backtests/research', params: { experimentId: id } } : '/backtests/research';
    case 'live_test': return id && ID.test(id) ? { pathname: '/backtests/live/[id]', params: { id } } : null;
    case 'holdings': return '/portfolio/holdings';
    // `at` makes a repeated request re-select the tab (see the Profile screen).
    case 'paper_portfolio': return { pathname: '/(tabs)/profile', params: { tab: 'Portfolio', at: String(Date.now()) } };
    case 'settings': return { pathname: '/(tabs)/profile', params: { tab: 'Settings', at: String(Date.now()) } };
    case 'calendar': return '/(tabs)/calendar';
    case 'community': return '/(tabs)/community';
    case 'compose_post': return '/community/compose';
    case 'news': return '/news';
    default: return null;
  }
}

export function parseActions(items: unknown): AiAction[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 3).flatMap((item): AiAction[] => {
    if (!isObj(item)) return [];
    const label = str(item.label, 40);
    if (!label) return [];
    if (item.kind === 'ask') {
      const prompt = str(item.prompt, 300);
      return prompt ? [{ kind: 'ask', label, prompt }] : [];
    }
    if (item.kind === 'open' && isObj(item.target) && typeof item.target.screen === 'string') {
      const href = actionHref({
        screen: item.target.screen,
        symbol: str(item.target.symbol, 30),
        timeframe: str(item.target.timeframe, 4),
        id: str(item.target.id, 64),
      });
      return href ? [{ kind: 'open', label, href }] : [];
    }
    return [];
  });
}
