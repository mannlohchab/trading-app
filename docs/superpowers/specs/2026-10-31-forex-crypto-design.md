# Forex and crypto as primary markets

## Intent and decisions

The user requested optimization for forex and crypto, with Twelve Data for forex and Binance WebSocket for live crypto. They explicitly selected forex and crypto as the primary markets. This design proposes how to deliver that change in the existing Expo 58 / React Native app and Express / Bun server.

The user has selected the market focus and providers. The design below was approved by the user on 2026-10-31 before implementation.

## Approaches

1. Extend the server's provider interface with asset-aware routing, cached Twelve Data requests, and a shared Binance connection. Reuse Socket.IO to distribute normalized updates. Recommended: it fits the existing architecture, shares upstream work across users, and keeps the forex API key on the server.
2. Connect each mobile/web client directly to Binance while proxying forex through the server. This reduces one network hop but duplicates connection, freshness, and subscription handling across clients and the backend.

Use the first approach. No framework or hosting changes are necessary. Keep existing Indian-equity providers reachable for saved instruments, but remove Indian-equity assumptions from the primary market experience.

## Scope

- Primary discovery, search, overview, starter watchlists, examples, and explicit demo preview focus on forex and crypto.
- Forex quotes and OHLC history come from Twelve Data. Crypto snapshots and OHLC history come from Binance REST; live crypto prices come from Binance WebSocket.
- Market screens, detail screens, and charts display the correct quote currency and precision, source, observation time, and unavailable/stale state.
- Preserve existing users, watchlists, INR balances, orders, and positions. Do not reset or silently convert them.
- This change is market-data and market-UI work. Multi-currency paper accounting, leveraged forex, futures, broker execution, and new trading-ticket UI are outside scope. Existing INR paper trading remains supported. Non-INR orders must receive an explicit unsupported-account-currency error rather than debit an INR account at a USD/USDT price. Apply this protection to pending-order execution too.

## Instrument and data contracts

Use canonical exchange/symbol identifiers: `FOREX:EUR/USD`, `FOREX:USD/JPY`, and `BINANCE:BTCUSDT`. Normalize supported aliases at the API boundary and URL-encode pair symbols. Preserve explicit NSE/BSE routing for old instruments; do not infer every unknown symbol as crypto or silently fall back across asset classes.

Add asset class, base currency, quote currency, and price precision metadata to instruments and quotes, while keeping existing fields compatible. Extend quote and candle source types with `twelvedata` and `binance`. Keep timestamps in Unix seconds throughout the app contract. Reject malformed, nonfinite, negative, or mismatched upstream data. Sort and deduplicate candles.

Start with a curated liquid universe: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT; EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD. Validate crypto availability and precision with cached Binance exchange metadata. Broader catalog discovery is not necessary for this change. Search supports names, canonical symbols, and common pair spellings within this universe, plus existing equities.

## Provider behavior and efficiency

Twelve Data reads `TWELVE_DATA_API_KEY` from server configuration only. Translate all existing timeframes explicitly. Request UTC timestamps; do not interpret forex bars in Indian exchange time. Cache and coalesce identical requests, bound cache sizes, and use configurable request-credit limits and polling intervals. Default conservatively to 8 credits/minute and 800 credits/day, configurable to the actual plan; account per symbol, including batches. Prioritize viewed quotes over background history; do not start forex polling without subscribers or a key. When the budget is exhausted, report last observation time/staleness or a clear unavailable response, without inventing live prices. The budget applies per server process; multi-instance shared quota coordination is outside this deployment's scope.

Binance uses one server-owned combined stream for the supported watched crypto pairs. Use ticker events for normalized quote updates and subscribed kline events for the active full-chart timeframe. REST supplies initial snapshots, historical candles, and gap recovery. Share streams across clients, cap subscriptions, close unused streams, reconnect with bounded backoff/jitter, resubscribe after disconnects, and detect stale connections. Handle the documented connection lifetime and ping/pong behavior of the selected runtime. Do not keep returning a cached quote marked live after upstream failure.

Socket.IO subscriptions identify both exchange and symbol, with compatibility for legacy equity symbol-only subscriptions. Validate subscription inputs and cap per-client subscriptions. Frontend subscription handling must reference-count shared interests, resubscribe on reconnect, and clean up handlers on unmount. Patch React Query quote caches directly, with bounded update frequency; do not invalidate and refetch the watchlist on each tick. REST refresh remains a slower recovery mechanism. Expose connection/freshness state separately from nominal market hours.

## Primary app behavior

Retain the existing visual layout and navigation. Order watchlist groups as Crypto, Forex, then existing equities/indices. Explore and Overview show crypto and forex sections and availability independently, so missing forex configuration does not hide working crypto quotes. Default discovery must be visible even for an existing account with an empty watchlist. New starter content uses the supported pairs; never replace a user's saved watchlist.

Replace equity-specific labels and search examples with instrument/pair language. Use instrument precision in quotes, changes, chart axes, crosshairs, and tooltips. Forex should retain meaningful pip decimals; low-priced crypto must not round to zero. Display USD, JPY, USDT, etc. explicitly and never label USDT as USD or INR. Existing INR portfolio totals retain their accounting currency.

Use rolling 24-hour history for crypto mini-charts; use a consistent UTC/provider session for forex. Retain the existing Indian session behavior for equities. Crypto's 24/7 label describes trading hours, not guaranteed connectivity. Forex session labels must be clearly indicative, including weekend closure; quote timestamps and provider status determine freshness.

Keep demo preview explicitly fictional and isolated from real network activity and account storage. Update its market examples to forex/crypto and preserve internally consistent sample portfolio accounting; no simulated prices may appear as fallback in live mode. Update AI defaults/examples to the new markets without fabricating live context.

## Configuration and documentation

Document the Twelve Data key, polling/cache/quota settings, Binance public endpoints, supported instruments, freshness semantics, and market-only limitation for non-INR paper orders in README and server API documentation. Update `.env.example`; do not overwrite actual environment files or expose secrets. Binance public market data does not need private trading credentials.

Provider references: https://twelvedata.com/docs and https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams. Verify implementation details against official documentation when implementing. Follow app/AGENTS.md for Expo documentation, lint, and typechecking.

## Validation and acceptance

Use deterministic provider fixtures and fake sockets to verify symbol normalization, timeframe translation, precision, timestamps, quota limiting, request coalescing, failures, out-of-order events, reconnect/resubscription, and cleanup. Verify that opening multiple consumers shares subscriptions and that quote ticks update the UI cache without HTTP request storms. Verify active candles update and gaps recover without corrupting history.

Run existing relevant backend and frontend tests, both TypeScript checks, and app lint. Add regression coverage for non-INR order rejection before mutation, including pending orders; retain equity fallback and explicit-demo isolation tests. Test primary discovery and formatting for EUR/USD, USD/JPY, BTCUSDT, and a low-priced crypto pair. Record any pre-existing check failures separately. Live endpoint smoke tests are conditional on credentials and network availability and must be reported honestly.

Acceptance: crypto and forex lead the app's market experience; real forex data uses Twelve Data; live crypto uses Binance WebSocket; currencies and precision are correct; disconnects and missing credentials are visible; old account data is preserved; no cross-currency paper-account corruption or implicit fake-data fallback occurs.

## Left to implementation

The builder chooses module names, exact cache structures, conservative render throttling, fake-socket test helpers, and small styling adjustments within the current design. Choose documented provider protocol details after verification. No changes to settlement currency or existing user balances are delegated as incidental implementation choices.
