// suggest_next_steps: buttons under the answer that open a screen or send a follow-up question.
// Every target is checked here (pair listed, run owned by this user), so a button never leads to a
// screen that would fail. The schema is flat on purpose: small models fill flat objects reliably.
import { z } from 'zod';
import { TIMEFRAMES } from '../../market/domain/market-options';
import { ACTION_SCREENS, type ActionTarget, type SuggestedAction } from '../domain/blocks';
import { defineTool, ToolInputError, type AssistantTool } from './tool-definition';
import type { MarketGateway } from './tools';

export type OwnedRunLookup = {
  backtest?: (id: string) => Promise<unknown>;
  experiment?: (id: string) => Promise<unknown>;
  liveTest?: (id: string) => Promise<unknown>;
};

const action = z.strictObject({
  kind: z.enum(['open', 'ask']).describe('open = take the user to a screen; ask = a follow-up question they can send with one tap'),
  label: z.string().trim().min(2).max(40).describe('Button text, 2-5 words, e.g. "Open backtest results" or "Try a 4h timeframe"'),
  screen: z.enum(ACTION_SCREENS).optional().describe('For open: the screen to open'),
  symbol: z.string().trim().min(2).max(30).optional().describe('For open instrument: pair such as BTCUSDT'),
  timeframe: z.enum(TIMEFRAMES).optional().describe('For open instrument: chart timeframe'),
  id: z.string().trim().max(64).optional().describe('For open backtest_result, live_test or research: the id returned by a tool in this conversation'),
  prompt: z.string().trim().min(2).max(300).optional().describe('For ask: the message to send, written as the user, e.g. "Backtest it on ETHUSDT too"'),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_ID = { backtest_result: 'backtest', live_test: 'liveTest' } as const;

export function createNextStepsTool(market: MarketGateway, runs: OwnedRunLookup): AssistantTool {
  let used = false;

  async function exists(lookup: ((id: string) => Promise<unknown>) | undefined, id: string) {
    if (!lookup || !UUID.test(id)) return false;
    try { await lookup(id); return true; } catch { return false; }
  }

  async function target(a: z.infer<typeof action>, index: number): Promise<ActionTarget> {
    const where = `actions.${index}`;
    if (!a.screen) throw new ToolInputError(`${where}: open needs a screen.`);
    if (a.screen === 'instrument') {
      const symbol = a.symbol?.toUpperCase();
      if (!symbol) throw new ToolInputError(`${where}: instrument needs a symbol.`);
      const matches = await market.searchSymbols(symbol);
      if (!matches.some(m => m.symbol === symbol)) throw new ToolInputError(`${where}: ${symbol} is not a listed ${market.exchange} pair.`);
      return { screen: 'instrument', symbol, ...(a.timeframe && { timeframe: a.timeframe }) };
    }
    if (a.screen === 'backtest_result' || a.screen === 'live_test') {
      if (!a.id || !(await exists(runs[NEEDS_ID[a.screen]], a.id))) {
        throw new ToolInputError(`${where}: ${a.screen} needs the id of one of this user's runs, as returned by a tool. Do not guess ids.`);
      }
      return { screen: a.screen, id: a.id };
    }
    if (a.screen === 'research' && a.id) {
      if (!(await exists(runs.experiment, a.id))) throw new ToolInputError(`${where}: unknown research experiment id. Omit id to open the Research workspace.`);
      return { screen: 'research', id: a.id };
    }
    return { screen: a.screen };
  }

  return defineTool(
    'suggest_next_steps',
    'Show 1-3 buttons under your answer: "open" takes the user to the screen where the result is or the next action happens; "ask" sends a follow-up question as the user. Call it in the same response as your answer text, at most once; you do not need to write anything after it.',
    z.strictObject({ actions: z.array(action).min(1).max(3) }),
    async ({ actions }) => {
      if (used) throw new ToolInputError('Next steps were already shown in this answer.');
      const items: SuggestedAction[] = [];
      for (const [index, a] of actions.entries()) {
        if (a.kind === 'ask') {
          if (!a.prompt) throw new ToolInputError(`actions.${index}: ask needs a prompt.`);
          items.push({ kind: 'ask', label: a.label, prompt: a.prompt });
        } else {
          items.push({ kind: 'open', label: a.label, target: await target(a, index) });
        }
      }
      used = true;
      return { result: { shownToUser: true, buttons: items.length }, blocks: [{ type: 'actions', items }] };
    },
    { terminal: true },
  );
}
