// Live demonstration: real Binance candles → our Postgres (market_candles) → Resin backtests.
// Run: bun demo.ts   (uses an in-memory Postgres via PGlite; needs internet for Binance)
import { createTestDb } from '../../tests/helpers/test-db';
import { binanceAdapters, createMarketModule } from '../../src/modules/market';
import { DrizzleCandleRepository } from '../../src/modules/market/infrastructure/drizzle-candle.repository';
import { DrizzleInstrumentRepository } from '../../src/modules/market/infrastructure/drizzle-instrument.repository';
import { strategyDefinitionSchema } from '../../src/modules/strategies/domain/definition';
import type { Timeframe } from '../../src/modules/market/domain/market-options';
import { definitionToPine } from './definition-to-pine';
import { RESIN_VERSION, runPineBacktest, type BacktestInput } from './pine-backtest';
import { runSandboxed } from './sandbox';

const SYMBOL = 'BTCUSDT', TIMEFRAME: Timeframe = '1h', PAGES = 5;
const RULES = { initialCapital: 10_000, commissionPercent: 0.1, slippageTicks: 1 };

const { appDb, close } = await createTestDb();
const market = createMarketModule({ db: appDb, requireActiveUser: (async (_c: unknown, next: () => Promise<void>) => next()) as any, exchanges: [binanceAdapters()] });
console.log(`Resin ${RESIN_VERSION} on Bun ${Bun.version}`);
console.log('catalog sync', JSON.stringify(await market.catalog.sync('BINANCE')));

// 1. Pull history through our market module; it saves every closed candle to market_candles.
let endTime: number | undefined;
for (let page = 0; page < PAGES; page++) {
  const { candles } = await market.service.candles({ exchange: 'BINANCE', symbol: SYMBOL, timeframe: TIMEFRAME, limit: 1000, endTime });
  endTime = candles[0]!.openTime - 1;
}

// 2. Read the history back from Postgres (the source of truth), not from the exchange.
const instruments = new DrizzleInstrumentRepository(appDb);
const instrument = (await instruments.findActive('BINANCE', [SYMBOL])).get(SYMBOL)!;
const stored = await new DrizzleCandleRepository(appDb).latest(instrument.id, TIMEFRAME, { limit: PAGES * 1000 });
console.log(`market_candles: ${stored.length} closed ${SYMBOL} ${TIMEFRAME} candles, ${new Date(stored[0]!.openTime).toISOString()} → ${new Date(stored.at(-1)!.closeTime).toISOString()}`);
console.log(`symbol properties from catalog: tick ${instrument.tickSize}, step ${instrument.stepSize}`);

const base: Omit<BacktestInput, 'source'> = {
  candles: stored,
  timeframe: TIMEFRAME,
  symbol: { tickSize: Number(instrument.tickSize), stepSize: Number(instrument.stepSize), ticker: SYMBOL, exchange: 'BINANCE' },
  rules: RULES,
};

// 3. Strategies: two hand-written Pine scripts and one AI-format definition compiled to Pine.
const rsiPine = `//@version=6
strategy("RSI mean reversion", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=20)
length = input.int(14, "RSI length")
r = ta.rsi(close, length)
trend = ta.sma(close, 200)
if ta.crossover(r, 30) and close > trend
    strategy.entry("Long", strategy.long)
if ta.crossunder(r, 70)
    strategy.close("Long", comment="RSI > 70")
strategy.exit("Bracket", "Long", stop=strategy.position_avg_price * 0.97, limit=strategy.position_avg_price * 1.06, comment_loss="SL", comment_profit="TP")
`;
const emaPine = `//@version=6
strategy("EMA 20/50 cross", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=50)
fast = ta.ema(close, 20)
slow = ta.ema(close, 50)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
`;
// The shape the AI assistant drafts (this one mirrors a draft from the live AI test).
const aiDraft = strategyDefinitionSchema.parse({
  market: { exchange: 'BINANCE', symbol: SYMBOL, timeframe: TIMEFRAME },
  direction: 'LONG',
  entry: { conditions: [
    { left: { type: 'RSI', period: 14 }, operator: 'LT', right: { type: 'VALUE', value: 30 } },
    { left: { type: 'PRICE' }, operator: 'GT', right: { type: 'SMA', period: 50 } },
  ] },
  exit: { conditions: [{ left: { type: 'RSI', period: 14 }, operator: 'GT', right: { type: 'VALUE', value: 70 } }], stopLossPercent: 5 },
  risk: { positionSizePercent: 10 },
});
const aiPine = definitionToPine('Conservative swing (AI draft)', aiDraft);

const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
for (const [label, source] of [['RSI mean reversion (Pine)', rsiPine], ['EMA 20/50 cross (Pine)', emaPine], ['AI draft → Pine', aiPine]] as const) {
  const r = runPineBacktest({ ...base, source });
  console.log(`\n=== ${label}`);
  if (!r.ok) { console.log('FAILED', r.stage, r.errors.join('; ')); continue; }
  const m = r.metrics;
  console.log(`trades ${m.totalTrades} (win ${fmt(m.winRatePercent)}%) | net ${fmt(m.netProfit)} USDT (${fmt(m.netProfitPercent)}%) | profit factor ${fmt(m.profitFactor)} | max DD ${fmt(m.maxDrawdownPercent)}% | buy&hold ${fmt(m.buyAndHoldReturnPercent)}% | exposure ${fmt(m.exposurePercent)}%`);
  console.log(`avg trade ${fmt(m.averageTrade)} | avg win ${fmt(m.averageWin)} | avg loss ${fmt(m.averageLoss)} | fees ${fmt(r.trades.reduce((a, t) => a + t.commission, 0))} | transpile ${r.timings.transpileMs} ms, run ${r.timings.runMs} ms`);
  for (const t of r.trades.slice(-3)) {
    console.log(`  ${t.entryTime.slice(0, 16)} @ ${t.entryPrice} → ${t.exitTime.slice(0, 16)} @ ${t.exitPrice}  qty ${t.size}  P/L ${fmt(t.profit)} (${fmt(t.profitPercent)}%) ${t.exitComment}`);
  }
}

// 4. Same backtest in the sandbox (worker + timeout + empty env): cost of isolation.
const t0 = performance.now();
const sandboxed = await runSandboxed({ ...base, source: emaPine }, { timeoutMs: 10_000 });
console.log(`\nsandboxed EMA run: ${sandboxed.ok ? 'ok' : sandboxed.stage}, ${Math.round(performance.now() - t0)} ms total (worker start + data transfer + run)`);
console.log('\nGenerated Pine for the AI draft:\n' + aiPine);

market.stop();
await close();
