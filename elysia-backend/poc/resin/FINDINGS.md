# Resin as our Pine Script backtesting engine: findings

**Recommendation: integrate Resin rather than build a custom engine.** It works with our stack, it is fast, its license allows commercial use, and it produced correct trades on our data. Three conditions apply:

- pin it to a reviewed git commit;
- run it isolated from the API process;
- guard it with our own regression tests.

Status: proof of concept in `backend/poc/resin/`. Nothing in `src/` uses it.

## What was demonstrated

| Step | Result |
|---|---|
| Accept a Pine Script strategy | v5 and v6 scripts transpile in 1–35 ms. Syntax errors, indicator-only scripts and `runtime.error()` halts are each reported by stage. |
| Run it on our historical Binance candles | 4,999 closed BTCUSDT 1h candles (2026-04-15 → 2026-11-09) went from Binance through our market module into `market_candles`, were read back from Postgres, and were backtested. Tick and step sizes come from our instrument catalog. |
| Generate simulated trades | Full List of Trades: entry and exit time and price, quantity, P/L, P/L %, commission, run-up and drawdown, exit reason (stop loss, take profit, rule). |
| Return metrics | Net profit, profit factor, win rate, average win, loss and trade, largest win and loss, max drawdown (bar-close and intrabar), buy & hold, exposure, equity curve. |
| AI strategies | Our engine-v1 definitions (what the assistant drafts) compile to Pine v6 (`definition-to-pine.ts`) and run. |

**Live results** (`bun demo.ts`, 10,000 USDT capital, 0.1% commission, 1 tick slippage):

| Strategy | Trades | Win % | Net P/L | Profit factor | Max DD | Fees |
|---|---|---|---|---|---|---|
| RSI mean reversion (hand-written Pine) | 4 | 75% | +1.77 | 1.03 | 1.07% | 15.97 |
| EMA 20/50 cross (hand-written Pine) | 46 | 23.9% | −245.83 | 0.90 | 11.37% | 462.73 |
| AI draft → Pine | 0 | | 0 | | 0% | 0 |

The AI draft made no trades because its two entry rules never hold together. It needs RSI(14) < 30 while price is above SMA(50). I checked this with our own indicator code: RSI was below 30 on 221 of 5,000 bars, and price was above SMA(50) on none of them. This is a real finding about AI drafts. A quick backtest before saving would catch such strategies.

**Correctness.** On 3,000 seeded candles, Resin's trades match an independently written simulator exactly, trade for trade: SMA cross, signal on close, fill at next open (`poc.test.ts`).

## Licensing

- **License:** Apache-2.0, with no runtime dependencies. Commercial and closed-source use is allowed. Running it on our server is not distribution. If we ever ship it, for example in the app, we must include the LICENSE and keep its notices; the repo has no NOTICE file.
- **Provenance (low risk, worth noting):**
  - The codebase was written by an autonomous AI agent loop (README).
  - It ports wavealgo's Python engine (`pine2py`); wavealgo is the same team.
  - Comments say PineTS (AGPL-3.0) was used only as a "semantic reference", not as copied code.
- **Trademark:** "Pine Script®" is a TradingView trademark, and Resin isn't affiliated with TradingView. In the app, call the feature "Pine Script-compatible", not "TradingView".

## Version: use 0.3.0 from git, not npm

npm's `@nullarch/resin@0.2.2` (August 2026) is far behind the repo's v0.3.0 tag (2026-09-28, commit `fa683a0`):

- **Commission:** 0.2.2 parses it and silently charges 0. I confirmed this in a test; net profit was identical with and without fees.
- **Slippage:** ignored in 0.2.2.
- **Symbol properties:** 0.2.2 has no `syminfo` (tick size) or `strategy` override options.
- **TradingView agreement:** the authors say 0.2.2 matched 2 of 19 TradingView strategy scenarios, against 19 of 19 for 0.3.0.

The POC pins `github:nullarch/resin#fa683a0…`. The project says minor versions may change computed values before 1.0, so store the engine version and commit with every backtest result.

## Performance

Runs under Bun 1.4 with no changes. Resin targets Node 22.18+, and our machine has Node 22.14. Benchmark (`bun bench.ts`, after warm-up):

| Bars | Strategy | Run time | Throughput | Memory |
|---|---|---|---|---|
| 10k | EMA cross | 35 ms | ~290k bars/s | ~30 MB |
| 100k | RSI + MACD + BB, bracket orders | 85 ms | ~1.2M bars/s | small |
| 500k (≈1 year of 1m candles) | EMA cross | 243 ms | ~2.0M bars/s | ~125 MB |
| 500k | RSI + MACD + BB, bracket orders | 363 ms | ~1.4M bars/s | ~60 MB |

Running in a sandboxed worker adds about 100 ms per job (worker start and data transfer). Loading candles from Postgres, not Resin, will be the main cost.

## Security

- **How scripts run:** compiled scripts execute through `new Function` in the calling thread, with the full privileges of our process (`process`, `fetch`, environment variables, database connections).
- **Probes:** the transpiler resisted every attempt. It rejected or safely compiled string-literal breakouts, template-literal injection, and identifiers named `process`, `globalThis`, `constructor`, `__proto__` and `fetch`. No generated code referenced a JavaScript global, and nothing escaped.
- **Source scan:** the source contains no file, network, child-process or environment access.
- **Runaway scripts:** each loop is silently capped at 10,000 iterations, where TradingView would error instead. Nested loops still multiply (10k × 10k per bar), so a timeout is required.
- **Defence in depth:** we shouldn't rely on the transpiler alone, because its 3 MB of source was written by an AI loop and has no security policy. The POC runs jobs in a Bun worker with an empty environment and a wall-clock timeout, and kills it on overrun (tested).
- **Production:** run backtests in a separate worker process or container, fed from `background_jobs`, with no network, no database or API credentials, and CPU and memory limits. Only that process gets the candles it needs.
- **User-provided Pine:** treat it as untrusted code. AI drafts compiled by `definition-to-pine.ts` are lower risk, since the generator emits only fixed templates and sanitised names (an injection test is included).

## Pine features checked

Supported in our probes:

- **Inputs:** `input.*`, with overrides at run time.
- **Orders:** `strategy.entry/close/close_all/order/exit` with stop, limit and trailing exits; limit and stop entries; short selling; pyramiding.
- **Statistics in scripts:** `strategy.netprofit`, `closedtrades`, `openprofit` and similar.
- **Indicators:** `ta.*` (SMA, EMA, RSI, MACD, BB, ATR, supertrend, pivots).
- **Language:** arrays, user-defined types, methods, `switch`.
- **Time:** time and session filters.
- **`request.security` to a higher timeframe:** daily values are built from our hourly candles.
- **Versions:** v5 and v6.

Not supported or limited:

- **Pine v4 and earlier:** rejected.
- **`ta.*` inside short-circuited `and`/`or`:** some placements are rejected with a clear message. Assigning the call to a variable first fixes it, and `definition-to-pine.ts` already does this.
- **`request.security` for other symbols:** we must supply their candles.
- **Time functions:** `hour`, `dayofweek` and `time()` use UTC. That's fine for 24/7 crypto, but needs care for forex sessions later.
- **No-ops:** alerts, `polyline`, `linefill`.
- **Known issue:** a same-symbol `request.security` returns higher-timeframe values one bar late.
- **Untested combinations:** the authors say feature combinations outside their 19 TradingView-verified scenarios may still differ.

## Integration complexity: low

- **Adapter:** about 250 lines (`pine-backtest.ts`). It maps our decimal-string candles to float arrays, our catalog to `syminfo`, and our fee rules to `strategy` overrides, then collects trades, metrics and the equity curve.
- **AI strategies:** `definition-to-pine.ts` compiles them, about 130 lines.
- **Floats:** Resin computes in float64, like TradingView. That's acceptable for research results; store them as NUMERIC strings with the engine version.
- **Fit with our schema:** `backtest_jobs`, `backtest_results` and `backtest_trades` map directly onto the result shape.

## Proposed next step (not done)

1. Add a `BacktestEngine` port in a backtesting module, with Resin as its first adapter, so a custom engine could replace it later.
2. Process `backtest_jobs` in an isolated worker process and save results and trades to the existing tables.
3. Keep our own regression tests: the reference simulator, and fixed BTCUSDT datasets with expected trade lists. Run them before any Resin upgrade.
4. Let the AI assistant quick-backtest drafts and warn on "0 trades" or contradictory rules.

## Files

`pine-backtest.ts` (adapter) · `definition-to-pine.ts` (AI definition → Pine) · `sandbox.ts` / `sandbox-worker.ts` (isolation) · `reference-sim.ts` (independent check) · `poc.test.ts` (9 tests) · `demo.ts` (live data run) · `bench.ts` (throughput)
