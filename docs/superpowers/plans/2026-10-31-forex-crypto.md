# Forex and Crypto Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** Make forex and crypto primary with Twelve Data forex and Binance streaming crypto.
**Architecture:** Asset router on the existing backend, shared streams through Socket.IO, cached REST history and normalized quote metadata.
**Tech Stack:** Bun, Express, TypeScript, Socket.IO, Expo 58, React Query.
**Spec:** docs/superpowers/specs/2026-10-31-forex-crypto-design.md (approved).

## Global Constraints
- Preserve existing accounts and saved instruments; non-INR paper orders are unsupported.
- No simulated fallback in live mode; preserve explicit preview isolation.
- Keys remain server-side; no framework change.
- Curated 6 crypto and 7 forex pairs; UTC history and currency-aware precision.

## Review Focus
- Missing forex key must not hide crypto discovery (Task 2).
- Disconnect and out-of-order updates must not make old prices appear live (Task 3).
- Multiple consumers must share subscriptions and survive reconnect (Task 4).
- Low-price crypto and JPY forex retain meaningful decimals (Task 4).
- Existing INR account must reject non-INR orders before mutation (Task 2).

### Task 1: Catalog and REST adapters
Files: server/src/providers/{types,instruments,providerCache,twelveData,binanceMarketData}.ts, server/src/lib/config.ts, server/tests/global-market.test.ts.
Interfaces: globalInstruments, resolveInstrument(symbol, exchange?), TwelveDataProvider and BinanceMarketDataProvider with quote/candles methods; Quote metadata currency, pricePrecision, assetClass, stale.
- [x] Write fixtures asserting aliases, timeframe translation, timestamps, precision, cache coalescing, quota and malformed responses. Run bun test tests/global-market.test.ts; expect missing modules.
- [x] Implement catalog, bounded request cache, quota-controlled Twelve Data adapter and Binance REST adapter with exchange metadata validation.
- [x] Run tests to green and server typecheck.

### Task 2: Routing, discovery and accounting guard
Files: server/src/providers/{marketData,globalMarketData}.ts, server/src/modules/{market/routes,trading/engine,auth/routes,ai/routes}.ts, server/src/providers/workersAi.ts, server/src/db/seed.ts.
Interfaces: GlobalMarketDataProvider implements existing MarketDataProvider plus explore(); getMarketDataProvider returns shared router with crypto/forex adapter references. requireInrInstrument(symbol, exchange) rejects non-INR orders.
- [x] Add tests for independent provider failures and non-INR order guard, run red.
- [x] Implement asset routing, primary overview/explore, starter instruments, AI defaults, guards for new and pending orders.
- [x] Run backend tests and typecheck.

### Task 3: Shared streaming
Files: server/src/providers/binanceStream.ts, server/src/marketSocket.ts, server/src/index.ts, server/tests/market-stream.test.ts.
Interfaces: BinanceStream.setStreams(streams), stop(); callbacks quote/candle/status; attachMarketSocket(io, provider) attaches validated subscriptions and demand-based forex polling.
- [x] Add fake-socket tests for subscription union, reconnect, stale handling, malformed and out-of-order events; run red.
- [x] Implement combined stream reconciliation, backoff, idle detection and rotation, cache ingestion, scoped Socket.IO delivery and candle subscriptions.
- [x] Run backend suites and typecheck.

### Task 4: Frontend market experience
Files: app/src/lib/{socket,quoteSubscriptions,liveMarket,format,marketGroups,marketHistory}.ts, app/src/hooks/use-live-market.ts, market/chart components and markets/stock/instrument screens; app/tests/global-market.test.mjs.
Interfaces: subscribeQuotes accepts exchange-qualified keys; subscribeCandles accepts instrument/timeframe; formatMarketPrice(value, metadata); updateMarketCaches(queryClient, quote).
- [x] Add tests for formatting, grouping, sessions, refcount/reconnect and cache patches; run red.
- [x] Implement metadata-aware quotes/charts, new market sections, primary discovery on empty watchlists, direct batched quote updates and active kline merging/gap recovery.
- [x] Run frontend tests, tsc, and lint.

### Task 5: Demo, documentation and full verification
Files: app/src/lib/demoData.ts, README.md, server/API.md, server/.env.example, app/tests/demo-preview.test.mjs.
- [x] Update explicit demo market fixtures to crypto/forex without changing INR portfolio economics; test isolation and discovery.
- [x] Document configuration, budget/freshness behavior and paper-order limitations.
- [x] Run all tests/typechecks/lint, conditional network smoke checks; obtain fresh final review and fix substantive findings with regressions.

## Execution ledger
Ruling: Execute in the supplied workspace without commits/worktree creation. Root/server are not Git repositories; app has an unborn repository with existing staged and untracked user work. Preserve that state and edit only task files.
Ruling: User approved implementation; execute inline without another plan approval gate.
Pre-flight: Task 1 metadata -> Task 2 routing -> Task 3 streaming -> Task 4 cache/UI -> Task 5 fixtures; all use exchange:symbol identity and Unix seconds.

Task 1: complete — REST adapter fixtures passed; backend typecheck passed.
Task 2: complete — routing and INR guard tests passed with existing provider tests.
Task 3: complete — fake-socket lifecycle tests passed; backend typecheck passed.
Task 4: implemented — formatting, session, subscription, cache and live chart tests passed; app typecheck passed.
Task 5: in progress — demo tests passed, documentation updated, whole-suite verification and final review next.
Ruling: Lint cannot currently bootstrap: compatible eslint-config-expo ~58.0.4 is not installed and dependency fetch fails DNS in the restricted environment. Do not substitute an older Expo lint config or change unrelated dependency versions.
Verification: 32 backend tests and 64 frontend tests passed; both TypeScript checks passed. Live Binance/Twelve Data smoke calls timed out in restricted network. TWELVE_DATA_API_KEY is not configured locally (presence checked without printing secrets). Expo web export requested for compile validation.
Final review: independent reviewer found three Important issues (subscription limit/reconnect, replay freshness, REST-vs-stream chart race), all reproduced and fixed with regression tests. A misleading awaiting-prices label was upgraded from minor to important because forex-only/newly opened screens could display it indefinitely; fixed and reproduced via the real hook's quote callback. No deferred findings.
Final fixes: bounded active subscription union reports overflow and promotes waiting keys; accepted current events alone refresh stream health; fresh history bypasses snapshot cache and reconciles through CandleBuffer; concurrent forex requests schedule quotes first. Shutdown regression prevents a metadata request from reopening a disposed stream and clears the pending-order timer.
Web export: completed successfully before final regression fixes; repeat export after those changes for final artifact verification.

Final verification: 36 backend tests + 67 frontend tests passed (103 total), both TypeScript checks passed, and Expo production web export succeeded at /tmp/forex-crypto-web. Git diff whitespace check passed for tracked app changes. Lint was attempted twice and remains unavailable because compatible lint dependencies cannot be fetched in the restricted environment. Binance/Twelve Data live endpoint calls timed out; local Twelve Data key is unset. No actual secrets or environment files were changed. All application changes are preserved in the supplied workspace; no commits, branches, pushes, or deployments were performed.
Task 5: complete within environment limits — tests and production web compilation verified; configuration and live smoke limitations documented for handoff.
