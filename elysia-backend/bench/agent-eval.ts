/**
 * Agent eval: runs real user tasks through the real assistant (real tools, in-memory Postgres,
 * fake Binance data) against live chat models, and checks whether each model used the right tools.
 *
 *   OPENROUTER_API_KEY=… bun bench/agent-eval.ts                     # free Nemotron
 *   CF_ACCOUNT_ID=… CF_API_TOKEN=… EVAL_MODELS=gpt-oss-120b bun bench/agent-eval.ts
 *   EVAL_MODELS=nemotron-free,gpt-oss-120b EVAL_TASKS=guide-holdings,rsi-backtest bun bench/agent-eval.ts
 *
 * Every task is a fresh conversation. Free endpoints share their rate limit with production:
 * one full run is roughly 12 tasks × 2-4 model calls per model. Results go to stdout as a table,
 * and as JSON to bench/results/agent-eval-<time>.json.
 */
import { mkdir } from 'node:fs/promises';
import { NEMOTRON_FREE_MODEL, OpenRouterChatProvider, WORKERS_AI_MODELS, WorkersAiProvider, type ChatModelProvider, type ModelProfile } from '../src/modules/ai';
import { createTestApp } from '../tests/helpers/test-app';
import { activeUser } from '../tests/helpers/users';
import { definition, recentWalk, seedCandles } from '../tests/backtesting/fixtures';

type Reply = { content: string; toolCalls: { name: string; ok: boolean; arguments: unknown }[]; blockTypes: string[] };
type Task = {
  id: string;
  prompt: string;
  context?: Record<string, unknown>;
  /** Each inner list is "any of these tools"; every list must be satisfied. */
  needs: string[][];
  /** Tools that should not run for this request. */
  avoid?: string[];
  /** Extra check on the reply; return a failure reason or null. */
  check?: (reply: Reply) => string | null;
};

const mentions = (...words: string[]) => (r: Reply) =>
  words.some(w => r.content.toLowerCase().includes(w.toLowerCase())) ? null : `reply never mentions ${words.map(w => `"${w}"`).join(' or ')}`;

export const TASKS: Task[] = [
  { id: 'guide-holdings', prompt: 'How do I add the coins I own so you can review them?', needs: [['get_app_guide']], check: mentions('Edit holdings', 'Paste from Excel', 'Add row') },
  { id: 'guide-watchlist', prompt: 'Can I set a price alert or add BTC to a watchlist?', needs: [['get_app_guide']], check: mentions('not available', "isn't available", 'not in the app', "doesn't have", 'does not have', 'no watchlist', 'no price alert') },
  { id: 'guide-results', prompt: 'Where do I find my old backtest results?', needs: [['get_app_guide', 'suggest_next_steps', 'list_backtests']], check: mentions('Run history', 'Backtesting') },
  { id: 'price-check', prompt: 'Check Bitcoin right now', needs: [['get_tickers', 'analyze_market']], avoid: ['draft_strategy', 'start_live_test'] },
  { id: 'movers', prompt: "What are today's biggest gainers?", needs: [['get_top_movers']] },
  { id: 'chart', prompt: 'Show me BTC on the 1h chart with its 20 and 50 moving averages', needs: [['show_chart']] },
  { id: 'context-pair', prompt: 'Is this a good time to enter?', context: { mode: 'analysis', symbol: 'SOLUSDT', exchange: 'BINANCE' }, needs: [['analyze_market', 'show_chart', 'get_tickers']],
    check: r => r.toolCalls.some(c => JSON.stringify(c.arguments).includes('SOLUSDT')) ? null : 'did not use the pair from the screen context' },
  { id: 'rsi-backtest', prompt: 'Make me a simple RSI dip-buying strategy for BTC on the 1h chart and backtest it', needs: [['draft_strategy'], ['run_backtest']], avoid: ['start_live_test'] },
  { id: 'my-strategy', prompt: 'Backtest my saved strategy over the last month', needs: [['list_strategies', 'run_backtest']], avoid: ['draft_strategy'] },
  { id: 'portfolio', prompt: 'Review my portfolio', context: { mode: 'portfolio' }, needs: [['get_my_holdings']] },
  { id: 'remember', prompt: "I'm a beginner and I never want to risk more than 1% of my account on a trade. Keep that in mind.", needs: [['remember']] },
  { id: 'no-live-start', prompt: 'Should I paper trade my EMA strategy?', needs: [], avoid: ['start_live_test', 'create_paper_account'] },
];

function providersFromEnv() {
  const providers: ChatModelProvider[] = [];
  const models: ModelProfile[] = [];
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (key) { providers.push(new OpenRouterChatProvider({ apiKey: key })); models.push(NEMOTRON_FREE_MODEL); }
  const accountId = process.env.CF_ACCOUNT_ID?.trim(), apiToken = process.env.CF_API_TOKEN?.trim();
  if (accountId && apiToken) { providers.push(new WorkersAiProvider({ accountId, apiToken })); models.push(...WORKERS_AI_MODELS); }
  return { providers, models };
}

function score(task: Task, reply: Reply) {
  const used = new Set(reply.toolCalls.filter(c => c.ok).map(c => c.name));
  const problems: string[] = [];
  for (const anyOf of task.needs) if (!anyOf.some(t => used.has(t))) problems.push(`missing ${anyOf.join('|')}`);
  for (const t of task.avoid ?? []) if (reply.toolCalls.some(c => c.name === t)) problems.push(`called ${t}`);
  if (!reply.content.trim()) problems.push('empty reply');
  if (/```|"conditions"\s*:/.test(reply.content)) problems.push('code in reply');
  const extra = problems.length ? null : task.check?.(reply);
  if (extra) problems.push(extra);
  return problems;
}

export async function runModel(model: ModelProfile, providers: ChatModelProvider[], tasks: Task[]) {
  const t = await createTestApp({ chat: { providers, models: [model], defaultModelId: model.id }, aiLimits: { turnsPerDay: 1000, tokensPerDay: 50_000_000 } });
  try {
    await t.market.catalog.sync('BINANCE');
    await seedCandles(t, recentWalk(t, 1500));
    const u = await activeUser(t);
    await u.c.post('/api/v1/strategies', { name: 'EMA cross', definition: definition() });
    await t.portfolio.service.replace(u.user.id, [
      { asset: 'BTC', quantity: '0.05', boughtOn: '2025-03-01', buyPrice: '62000' },
      { asset: 'ETH', quantity: '1.2', boughtOn: '2025-06-10', buyPrice: '2500' },
      { asset: 'SOL', quantity: '10', boughtOn: '2025-08-20' },
    ]);
    const rows = [];
    for (const task of tasks) {
      const conversation = (await u.c.post('/api/v1/ai/conversations', {})).body.id as string;
      const started = performance.now();
      const res = await u.c.post(`/api/v1/ai/conversations/${conversation}/messages`, { content: task.prompt, stream: false, ...(task.context && { context: task.context }) });
      const ms = Math.round(performance.now() - started);
      const message = res.body?.assistantMessage;
      if (res.status !== 201 || !message) {
        rows.push({ model: model.id, task: task.id, pass: false, problems: [`HTTP ${res.status}: ${res.body?.code ?? ''} ${res.body?.error ?? ''}`.trim()], ms, tools: [], nextSteps: false, tokens: 0, reply: '' });
        continue;
      }
      const reply: Reply = {
        content: message.content,
        toolCalls: (message.metadata.toolCalls ?? []).map((c: any) => ({ name: c.name, ok: c.ok, arguments: c.arguments })),
        blockTypes: (message.metadata.blocks ?? []).map((b: any) => b.type),
      };
      const problems = score(task, reply);
      rows.push({
        model: model.id, task: task.id, pass: !problems.length, problems, ms,
        tools: reply.toolCalls.map(c => `${c.name}${c.ok ? '' : '✗'}`), nextSteps: reply.blockTypes.includes('actions'),
        tokens: (message.tokenUsage?.inputTokens ?? 0) + (message.tokenUsage?.outputTokens ?? 0), reply: reply.content,
      });
      console.error(`${model.id} ${task.id}: ${problems.length ? `FAIL (${problems.join('; ')})` : 'ok'} in ${(ms / 1000).toFixed(1)}s`);
    }
    return rows;
  } finally {
    await t.close();
  }
}

if (import.meta.main) await main();

async function main() {
  const { providers, models } = providersFromEnv();
  const wanted = process.env.EVAL_MODELS?.split(',').map(s => s.trim()).filter(Boolean) ?? ['nemotron-free'];
  const selected = models.filter(m => wanted.includes(m.id));
  if (!selected.length) {
    console.error(`No configured model matches EVAL_MODELS=${wanted.join(',')}. Configured: ${models.map(m => m.id).join(', ') || 'none (set OPENROUTER_API_KEY or CF_ACCOUNT_ID/CF_API_TOKEN)'}`);
    process.exit(1);
  }
  const only = process.env.EVAL_TASKS?.split(',').map(s => s.trim()).filter(Boolean);
  const tasks = only ? TASKS.filter(t => only.includes(t.id)) : TASKS;

  const results = [];
  for (const model of selected) results.push(...await runModel(model, providers, tasks));

  for (const model of selected) {
    const mine = results.filter(r => r.model === model.id);
    const passed = mine.filter(r => r.pass).length;
    const median = mine.map(r => r.ms).sort((a, b) => a - b)[Math.floor(mine.length / 2)] ?? 0;
    console.log(`\n## ${model.label} (${model.id}): ${passed}/${mine.length} passed · median ${(median / 1000).toFixed(1)}s · next-step buttons on ${mine.filter(r => r.nextSteps).length}/${mine.length}`);
    console.log('| task | result | time | tools |\n|---|---|---|---|');
    for (const r of mine) console.log(`| ${r.task} | ${r.pass ? 'pass' : `FAIL: ${r.problems.join('; ')}`} | ${(r.ms / 1000).toFixed(1)}s | ${r.tools.join(', ') || '—'} |`);
  }
  const dir = new URL('./results/', import.meta.url).pathname;
  await mkdir(dir, { recursive: true });
  const file = `${dir}agent-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await Bun.write(file, JSON.stringify(results, null, 2));
  console.log(`\nFull replies: ${file}`);
}
