# Trading backend (Hono)

The TradingGurukul API, built with [Hono](https://hono.dev) on Bun, with PostgreSQL via [Drizzle ORM](https://orm.drizzle.team). Runs on port 4001.

```bash
cp .env.example .env
bun install
bun run dev:setup    # Postgres 17 in Docker on localhost:5433, migrations, and the test user
bun run dev          # http://localhost:4001/health
bun test
bun run typecheck
```

`dev:setup` runs `db:up` (needs Docker access), `db:migrate` and `db:seed-test-user`. The test user is
`test@gmail.com` / `pass1234`, already ACTIVE with a verified phone, so it skips the OTP step. The seed
refuses to run with `NODE_ENV=production`.

## Database workflow

- Tables live in `src/db/schema/<domain>/<table>.ts` (identity, verification, profiles, ai, market, strategies, backtesting, paper-trading, system), with shared enums in `schema/enums.ts` and column builders in `schema/columns.ts`. Columns are camelCase in code and snake_case in the database.
- Relations for `db.query.*` live in `src/db/relations/<domain>.relations.ts`, one `relations()` per table. A new table needs its file, an export in its domain's `index.ts`, and its relations.
- Import from `src/db` (`import { db, users } from './db'`).
- `bun run db:generate` writes a SQL migration to `./drizzle` from schema changes. Commit these files.
- `bun run db:migrate` applies pending migrations. It needs only `drizzle-orm`, so it runs in production.
- `bun run db:push` syncs the schema directly without a migration (local prototyping only).
- `bun run db:studio` opens Drizzle Studio.
- Things Drizzle can't express (extensions, triggers, seed rows) go in custom migrations: `bunx drizzle-kit generate --custom --name=<name>`. `0001_triggers_and_seed.sql` holds the `updated_at` triggers and the Binance seed. **Any new table with an `updated_at` column needs its trigger added this way.**
- NUMERIC columns (prices, balances, quantities) are returned as strings. Do decimal math in SQL or with a decimal library, never with JS floats. Nested relational queries return rows as JSON; `src/db/json.ts` keeps NUMERIC exact on that path too.
- Tests run the real migrations against an in-memory Postgres ([PGlite](https://pglite.dev)) via `tests/helpers/test-db.ts`, so `bun test` needs no database server.

## Architecture

A modular monolith organized by business domain. Each module in `src/modules/<domain>/` has:

- `domain/`: business rules as pure functions (no Hono, Better Auth, Drizzle or I/O).
- `application/`: use cases plus the ports (interfaces) they need.
- `infrastructure/`: adapters implementing those ports (Drizzle, Better Auth, SMS…).
- `http/`: Hono routes and middleware.
- `index.ts`: the module's public surface and wiring.

`src/app.ts` builds the HTTP app from modules (`createApp`); `src/index.ts` is the production composition root. PostgreSQL is the source of truth.

## Authentication (`modules/identity`)

Flow: sign in with Google, Apple or email → the user is `PENDING_PHONE_VERIFICATION` → send OTP → verify OTP → account becomes `ACTIVE`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/auth/sign-up/email` | Register (`{ email, password, name }`) |
| POST | `/api/v1/auth/sign-in/email` | Email login |
| POST | `/api/v1/auth/sign-in/social` | Start Google/Apple login (`{ provider, callbackURL }` → `{ url }`; or `{ provider, idToken }` for native) |
| GET/POST | `/api/v1/auth/callback/:provider` | OAuth callback (Apple uses POST) |
| POST | `/api/v1/auth/phone-number/send-otp` | Send OTP to `{ phoneNumber }` (E.164). Requires a session |
| POST | `/api/v1/auth/phone-number/verify` | Verify `{ phoneNumber, code }`, attach the number to the signed-in user, activate |
| GET | `/api/v1/auth/get-session` | Current session and user (`status`, `phoneNumberVerified`, …) |
| POST | `/api/v1/auth/sign-out` | Log out (deletes the session) |

- Protect application endpoints with `identity.requireActiveUser`: 401 without a session, 403 `PHONE_VERIFICATION_REQUIRED` for pending users, 403 `ACCOUNT_DISABLED` for suspended/deleted ones. Suspended/deleted users can't sign in at all.
- OTPs: 6 digits, 5 minutes, 5 attempts, 60 s resend cooldown, 5 sends per hour per phone/user. Stored only as an HMAC in `phone_verifications`.
- SMS goes through the `SmsSender` port. Only the `console` adapter exists so far, so a real provider is needed before production.
- Rate limits (per client IP): sign-in 10/min, sign-up 5/min, send-otp 3/min, verify 10/min. Set `TRUSTED_PROXY_IP_HEADER` when deployed behind a proxy, or all traffic shares one IP.
- Phone-number login and phone password reset are disabled.
- **Mobile app:** `@better-auth/expo` stores the session cookie in SecureStore and sends it as a `Cookie` header (also on the market WebSocket). Its origin, `tradinggurukul://`, must be in `AUTH_TRUSTED_ORIGINS`. Outside production, Expo Go's `exp://` origins are trusted automatically.

## Profile & preferences (`modules/profiles`)

All require an ACTIVE user (signed in, phone verified).

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/me/profile` | `{ id, name, username, image, email, phoneNumber, timezone }` |
| PATCH | `/api/v1/me/profile` | Update any of `name`, `username` (unique, case-insensitive; `null` clears), `image` (https URL; `null` clears), `timezone` (IANA) |
| GET | `/api/v1/me/preferences` | `{ general, trading, ai }` (defaults until first saved) |
| PATCH | `/api/v1/me/preferences` | Partial update of any section |

- **general:** `language` (BCP 47), `timezone`, `currency`, `theme` (`LIGHT`/`DARK`/`SYSTEM`), `notificationsEnabled`
- **trading:** `exchange` (code, e.g. `BINANCE`), `marketType` (`SPOT`/`PERPETUAL`/`FUTURES`/`FOREX`), `tradingPair` (an active symbol on that exchange, matching the market type), `timeframe` (`1m`…`1M`), `chartType` (`CANDLES`/`HEIKIN_ASHI`/`BARS`/`LINE`/`AREA`)
- **ai:** `responseStyle` (`CONCISE`/`BALANCED`/`DETAILED`), `explanationLevel` (`BEGINNER`/`INTERMEDIATE`/`ADVANCED`), `language` (`null` = app language)

Timezone is a single setting, shown in both the profile and `general.timezone`. Errors are `{ error, code, fields? }`; invalid input returns 400 `VALIDATION_ERROR` with a message per field.

## Account deletion (`modules/identity`)

`POST /api/v1/me/deletion-request` with `{ "confirm": true, "reason"?: string }`. Any signed-in user (pending or active) can call it, but the session must be under 24 hours old (otherwise 403 `REAUTHENTICATION_REQUIRED`). It immediately sets the account to `DELETED`, ends every session (sign-in is then refused) and queues an `identity.account.purge` job in `background_jobs` for 30 days later. Returns 202 `{ status, purgeAfter }`. **No worker processes the purge job yet.**

## Market data (`modules/market`)

Crypto first: Binance spot via its free public API (`data-api.binance.vision` for REST, `data-stream.binance.vision` for streams; no API key). Each exchange is a pair of adapters behind `MarketDataProvider` (REST) and `LiveFeed` (streaming) in `application/ports.ts`. Adding forex or another exchange means writing those two adapters, adding an `exchanges` row, and registering them in `src/index.ts`. Routes, storage and the hub stay the same.

All endpoints require an ACTIVE user. `exchange` defaults to `BINANCE`. Prices and sizes are exact decimal strings; times are Unix ms.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/market/exchanges` | Exchanges with a registered provider |
| GET | `/api/v1/market/symbols?quote=USDT&q=btc&limit=100&offset=0` | Search the instrument catalog (tick/step sizes, precision, min notional) |
| GET | `/api/v1/market/tickers?symbols=BTCUSDT,ETHUSDT` | 24h tickers for up to 100 symbols |
| GET | `/api/v1/market/tickers?quote=USDT&sort=volume\|gainers\|losers&limit=100` | Market overview list |
| GET | `/api/v1/market/candles?symbol=BTCUSDT&timeframe=1h&limit=300&endTime=` | OHLCV, oldest first; `source` is `exchange` or `store` |
| WS | `/api/v1/market/stream` | Live tickers and candles |

**WebSocket protocol.** Send `{"op":"subscribe","topics":["ticker:BINANCE:BTCUSDT","candles:BINANCE:BTCUSDT:1m"]}`, `{"op":"unsubscribe","topics":[…]}` or `{"op":"ping"}`. Receive `subscribed` (with per-topic `rejected` reasons), `ticker`, `candle` (with `isClosed`), `status` (`connecting`/`live`/`reconnecting`/`idle`), `error`, `pong`. Limits: 50 topics per connection, 30 messages per 10 s, 16 KB per message. Slow readers are disconnected.

**Postgres is the source of truth.**
- **Catalog:** `trading_symbols` is synced on boot when older than 24 h and re-checked every 6 h (`bun run market:sync` forces it). Delisted symbols are deactivated, not deleted.
- **History:** closed candles from both REST responses and the live stream are saved to `market_candles`. If Binance is unreachable, candles are served from there.
- **Live data:** tickers and open candles pass through and are not stored.

**Protecting the upstream.**
- **One upstream socket:** a single Binance connection serves every client. Subscriptions change in place (SUBSCRIBE/UNSUBSCRIBE), with no reconnect.
- **Shared ticker fetch:** REST tickers come from one cached all-symbols call (5 s TTL).
- **Rate-limit backoff:** on HTTP 429/418 calls stop until Binance's `Retry-After` passes.

## AI assistant (`modules/ai`)

A tool-using assistant on Cloudflare Workers AI. It answers market questions from live data, analyses charts with server-computed indicators, and drafts trading strategies the user can save.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/ai/models` | Models available now |
| GET | `/api/v1/ai/usage` | Today's turns, tokens, cost and limits |
| POST / GET | `/api/v1/ai/conversations` | Create / list (`?status=ARCHIVED`, `?before=<ISO>` paging) |
| GET / PATCH / DELETE | `/api/v1/ai/conversations/:id` | Read / rename or archive / delete (soft) |
| GET | `/api/v1/ai/conversations/:id/messages?before=<messageId>` | Message history, oldest first |
| POST | `/api/v1/ai/conversations/:id/messages` | `{ content, model?, stream? }`: SSE by default, JSON with `stream: false` |
| POST | `/api/v1/ai/conversations/:id/messages/:messageId/strategies` | `{ draftId }`: save a strategy draft (idempotent) |

**SSE events.** `user_message`, `status` (`thinking`, or `tool` with the tool name), `delta` (text), `block` (a data card as soon as it exists), `assistant_message` (final saved message), then `done`, or `error` with a code.

**Structured replies.** `assistantMessage.metadata.blocks` holds, in order:
- `markdown`: the model's answer;
- data cards: `ticker`, `market_list`, `market_analysis`;
- `strategy_draft`: the validated definition plus a plain-language summary;
- `disclaimer`.

Cards are built from tool results, not model text, so they always show observed values.

**Tools.** `search_symbols`, `get_tickers`, `get_top_movers`, `analyze_market` and `draft_strategy`. They call the market and strategies modules. Invalid arguments are returned to the model so it can correct them, and a turn has at most 4 tool rounds.

**Providers.**
- **Adding one:** implement `ChatModelProvider` (`application/ports.ts`) and add `ModelProfile`s, as `WorkersAiProvider` and `WORKERS_AI_MODELS` do.
- **Workers AI:** uses the OpenAI-compatible endpoint. The default is `llama-4-scout`, falling back to `mistral-small-3.1` when the default fails before producing output. Both models were checked end to end on streaming, tool calls and answers from tool results.
- **Persona:** the user's AI preferences (style, explanation level, language) and timezone shape the system prompt.

**Usage and cost.** Every model call is a row in `ai_usage_events` with tokens, Cloudflare neurons, latency, model and status. Daily per-user limits (`AI_DAILY_TURN_LIMIT`, `AI_DAILY_TOKEN_LIMIT`) are checked against it. Measured live: about 150 to 200 neurons per question, while the Workers AI free allowance is 10,000 neurons a day per account.

## Strategies (`modules/strategies`)

`GET /api/v1/strategies`, `GET /api/v1/strategies/:id`, `POST /api/v1/strategies`. A definition (engine `v1`) is:
- a market (exchange, symbol, timeframe), LONG only;
- entry conditions (all must hold) and exit conditions (any one is enough), built from PRICE, VOLUME, SMA, EMA, RSI, MACD and BOLLINGER with GT, LT, CROSSES_ABOVE and CROSSES_BELOW;
- stop loss and take profit percentages;
- position size.

Versions are immutable (`strategy_versions`). AI drafts are saved with `source: AI_GENERATED`.

## Backtesting (`modules/backtesting`)

Runs a saved strategy version over stored historical candles. **Resin** (Pine Script v5/v6, Apache-2.0) is the first engine behind the `BacktestEngine` interface (`engines/backtest-engine.interface.ts`). It is pinned to commit `fa683a0` (v0.3.0) from GitHub, not npm; see `poc/resin/FINDINGS.md`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/backtests` | `{ strategyId, strategyVersionId?, market?, range?: { start?, end? }, settings? }` → 202, queued |
| GET | `/api/v1/backtests?limit&before&status&strategyId` | The user's backtests, newest first |
| GET | `/api/v1/backtests/:id` | Status, summary metrics, settings, engine, dataset, warnings, script |
| GET | `/api/v1/backtests/:id/trades?limit&offset` | Paginated trades |
| GET | `/api/v1/backtests/:id/equity-curve?maxPoints` | Equity curve (min/max-preserving downsample) |
| POST | `/api/v1/backtests/:id/cancel` | Cancel a queued or running backtest |
| POST | `/api/v1/backtests/preview` | Quick backtest of an **unsaved** definition (AI drafts); nothing is stored |

Active, phone-verified users only. The user always comes from the session, and every read and write checks ownership.

**Flow.**
1. Validate the request.
2. Load the user's exact immutable strategy version.
3. Generate Pine with `engines/resin/definition-to-pine.ts`, the POC converter, kept identical by a test.
4. Insert a `backtest_jobs` row and a `background_jobs` row in one transaction.
5. A worker claims the job (`FOR UPDATE SKIP LOCKED`).
6. It backfills any missing candles from Binance into `market_candles`.
7. It loads closed candles from Postgres and validates them: unfinished, duplicate, wrong-timeframe and missing candles, and warm-up length.
8. It runs the engine in the sandbox and computes metrics in exact decimals (`utils/decimal.ts`).
9. It stores the summary, trades and equity curve in one transaction, only while the backtest is still `RUNNING`.

**Defaults** (`backtesting.constants.ts`): 10,000 initial capital in the quote asset; 0.1% commission per side; 1 tick of slippage; position size from the strategy's `positionSizePercent`; the last 1,000 closed candles. Limits: 50,000 candles per backtest, 3 active backtests per user, a 60 s wall clock and 60 s of CPU, 1 GiB of memory.

**Reproducibility.** `backtest_jobs.configuration` records:
- the strategy and its exact version;
- the Pine source and its SHA-256;
- the engine name, version and git revision;
- the symbol's tick and lot sizes;
- the range and settings, plus fill and fee assumptions;
- the dataset: candle count, first and last time, gaps and a SHA-256 of the candles used.

**Sandbox** (`workers/backtest.worker-manager.ts`). Every run is a fresh OS process under `prlimit` (memory, CPU, file size and open-file limits) and `bwrap`:
- new network, PID and IPC namespaces, with **no network**;
- an empty environment;
- only `/usr` and `/lib` plus a self-contained worker bundle mounted read-only, so the app directory and `.env` are invisible.

The API process loads data and validates the worker's input and output; it never executes scripts. Startup runs a probe proving isolation before the job runner starts. On hosts without unprivileged namespaces, use `BACKTEST_SANDBOX=process` inside a container that has no network and no secrets.

**Jobs.** `modules/system/jobs` implements a queue on `background_jobs`:
- atomic claim with `FOR UPDATE SKIP LOCKED`;
- lease fencing, so a worker that lost its lease cannot write;
- backoff retries for transient failures (market data, sandbox start);
- stale-lease recovery for crashed workers;
- cancellation.

The runner runs inside the API (`BACKGROUND_JOBS_ENABLED`) or separately with `bun run jobs`.

**Upgrading Resin.** Change the pinned commit in `package.json` and `RESIN_REVISION`/`RESIN_EXPECTED_VERSION` in `engines/resin/resin.engine.ts`. Then run `bun test tests/backtesting/regression.test.ts`: it covers the POC's independent simulator, converter parity, the pin itself, and a golden snapshot. Review any snapshot diff before updating it.

## Paper trading (`modules/paper-trading`)

Simulated trading with virtual funds on **live Binance market data**. It never calls a Binance trading, account or key endpoint: the module only reads quotes from the market module (`tests/paper-trading/no-real-trading.test.ts` enforces this). Active, phone-verified users only, and every read and write checks ownership.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/paper/accounts` | `{ name, initialBalance?, baseCurrency?, settings? }`. The balance is fixed at creation (100 to 10,000,000, default 10,000). |
| GET | `/api/v1/paper/accounts` | The user's accounts |
| GET / PATCH | `/api/v1/paper/accounts/:id` | Read the account, or rename it and change its settings. Funds cannot be changed. |
| GET | `/api/v1/paper/accounts/:id/portfolio` | Cash, reserved, available, equity, realized and unrealized P&L, fees, return, and open positions marked to market |
| GET | `/api/v1/paper/accounts/:id/transactions?limit&offset` | The append-only ledger |
| POST | `/api/v1/paper/orders` | `{ accountId, symbol, side, type: MARKET\|LIMIT\|STOP_MARKET, quantity, price?, stopPrice?, reduceOnly?, stopLoss?, takeProfit?, clientOrderId? }`. Also accepts an `Idempotency-Key` header. |
| GET | `/api/v1/paper/orders?accountId&status&symbol&limit&before` | Orders, newest first |
| GET | `/api/v1/paper/orders/:id` | One order |
| POST | `/api/v1/paper/orders/:id/cancel` | Cancel an open order and release its reservation |
| GET | `/api/v1/paper/positions?accountId&status` | Positions |
| GET | `/api/v1/paper/positions/:id` | One position |
| POST | `/api/v1/paper/positions/:id/close` | Close at market, as an idempotent reduce-only order |
| POST | `/api/v1/paper/strategies/:id/start` | `{ accountId, strategyVersionId?, symbol?, timeframe? }`. Runs a saved strategy automatically. |
| GET | `/api/v1/paper/strategies[/:id]` | Strategy instances |
| POST | `/api/v1/paper/strategies/:id/pause` / `resume` / `stop` | `stop` takes `{ closePosition? }` |

**Idempotency.** An order with a `clientOrderId` that was already used returns the original order (HTTP 200 instead of 201), enforced by a unique index per account. Strategy orders use the key `signal:<signalId>` and position closes use `close:<positionId>`, so retries and crash recovery never place an order twice.

**Fill rules** (`execution/order-fill.engine.ts`):
- The last price decides triggers and eligibility; fills use bid and ask.
- MARKET fills at the touch, with `slippageBps` (default 5) against the order, rounded to the tick: up for buys, down for sells.
- LIMIT fills at the touch if it is marketable on arrival. Otherwise it rests and fills at its own limit price once the last price crosses it.
- STOP_MARKET triggers on the last price, then fills like a market order, including across gaps.
- A quote older than 15 s is stale. Market orders are rejected rather than filled on a stale price, and the engine sweep expires market orders that stay open longer than 60 s.
- Accounts hold USDT, so only USDT-quoted pairs can be traded (a BTC-priced pair would otherwise book BTC amounts as USDT).
- Quantities must sit on the symbol's lot step and price filters, and must meet its minimum notional.
- Commission is 0.1% by default, rounded up to 8 decimals.
- Stop-loss and take-profit become reduce-only STOP_MARKET and LIMIT orders in one OCO group. When one fills, the other is cancelled, and reduce-only orders are cancelled when their position closes.

**Accounting** (1×, one-way, longs and shorts; all exact decimals, never floats):
- Cash changes only through the initial deposit, realized P&L and fees.
- Reserved = open-order reservations (with a 2% buffer for market orders) + position collateral.
- Available = cash − reserved. Equity = cash + unrealized P&L.
- A position keeps its exact collateral. A partial close releases a proportional share and a full close releases all of it, so no rounding dust remains.
- Realized P&L = proceeds − the released cost basis.
- A short is liquidated at market when its loss reaches its collateral.

**Ledger and reconciliation.**
- Every balance change writes `paper_transactions` rows in the same transaction as the change: `ORDER_RESERVE/RELEASE`, `ORDER_FILL`, `POSITION_MARGIN/_RELEASE`, `REALIZED_PNL`, `TRADING_FEE` and `INITIAL_DEPOSIT`.
- Each row has a unique `entryKey` and a gap-free per-account `sequence`.
- A database trigger rejects `UPDATE` and `DELETE` on the ledger (migration 0007).
- `reconcileAccount` replays the ledger and compares it with the stored cash, reserved, realized and fee totals.

**Concurrency.**
- Every mutation takes row locks in a fixed order: account, then orders, then position. This order prevents deadlocks.
- State is re-checked after locking.
- Partial unique indexes allow one OPEN position per account and symbol, and one live strategy instance per account and symbol.

**Engine** (`workers/paper-trading.worker.ts`, `PAPER_ENGINE_ENABLED`):
- Subscribes through the market hub to tickers for symbols with open orders or positions, and to klines for running strategies.
- Coalesces tick processing per symbol.
- Ignores out-of-order events.
- A sweep every 15 s catches up on due strategy evaluations and on stuck orders.
- On restart it rebuilds everything from Postgres, so no in-memory state is authoritative.
- **Run exactly one engine per deployment.** Correctness does not depend on this, because fills are locked and fenced, but duplicate engines waste work.

**Strategy automation.** On each closed candle the engine enqueues a `paper.strategy.evaluate` job, deduplicated per instance.
1. The job loads the candle window from `market_candles`, recovering gaps over REST.
2. It runs the strategy's Resin script in the same `bwrap` sandbox as backtesting, in signals mode, so the API never runs strategy code.
3. It records `paper_signals`. Only the newest pending candle is traded; older ones are recorded as `SKIPPED`.
4. It places orders sized from `positionSizePercent` of cash, floored to the lot step.
5. It commits only if the instance is still running and its `lastProcessedCandleTime` has not moved.

## Health checks

- `GET /health`: liveness (process is up).
- `GET /health/ready`: readiness (Postgres answers `select 1`). Returns 503 when it doesn't.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4001` | |
| `CLIENT_ORIGIN` | `*` | Comma-separated allowed origins. `*` echoes the request origin (dev only). |
| `DATABASE_URL` | local Docker DB | **Required** when `NODE_ENV=production`. |
| `DATABASE_POOL_MAX` | `10` | Max pooled connections. |
| `DATABASE_SSL` | `disable` (`require` in production) | Use `require` for managed Postgres. |
| `PAPER_ENGINE_ENABLED` | `true` | Run the paper-trading engine (live fills, strategy scheduling) in this process. Enable it in exactly one process. Evaluation jobs run wherever the job runner runs. |
