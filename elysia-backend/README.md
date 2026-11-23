# Trading backend (Elysia)

The TradingGurukul API, built with [Elysia](https://elysiajs.com) on Bun, with PostgreSQL via [Drizzle ORM](https://orm.drizzle.team). Runs on port 4001.

```bash
cd elysia-backend
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

## Elysia rewrite

This is a standalone alternative to `../backend`, with the same `/api/v1` endpoints, payloads,
Better Auth sessions, Postgres schema/migrations, jobs, and trading engines. It has no runtime
imports from the original backend and no Hono dependency. Domain logic and repositories are
retained; routing, authentication guards, HTTP lifecycle, WebSockets and SSE are native Elysia/Bun.
`GET /health` retains `service: "trading-backend"` for existing monitors.

- Production starts through `app.listen()` so Elysia can compile routes and use Bun's native router.
- JSON bodies are read once by the existing Zod validators, preserving field errors and status codes.
- Guards are local to each module. Public auth and community images remain public.
- Credentialed CORS, security headers, request IDs, and private Prometheus metrics are retained.
- HTTP access logging is off the request path; structured domain/job logging and unexpected-error
  logging remain enabled. Use reverse-proxy access logs when request-level records are needed.
- WebSocket limits apply per connection. Bun rejects oversized frames before JSON decoding;
  clients may observe an abnormal closure (`1006`) for a transport-level size rejection.
- SSE honors backpressure and cancels upstream work when the client disconnects. Community
  uploads are bounded while reading, including requests without a trustworthy Content-Length.

To reuse a running development database, configure `DATABASE_URL` and run `bun run db:migrate`
instead of `dev:setup`. The new Compose project otherwise creates its own volume and needs port
5433 to be free. Both backends use the same migration history; do not run independent schema
changes against one shared database.

For a side-by-side API trial, use separate API/metrics ports:

```bash
PORT=4002 METRICS_PORT=9465 BETTER_AUTH_URL=http://localhost:4002 \
  BACKGROUND_JOBS_ENABLED=false PAPER_ENGINE_ENABLED=false bun run dev
```

Keep the same `BETTER_AUTH_SECRET` when sharing existing sessions and set trusted origins to your
frontend's origin. Point the frontend's API base URL at the selected server. Keep paper execution
and scheduled jobs enabled in only the intended worker deployment when both APIs share a database.
The existing backend is left intact for rollback.

## Production deployment

The image runs as the non-root `bun` user. Its startup command verifies the backtest sandbox,
then applies migrations, then starts the API. A failed isolation check stops startup before any
migration. `/health/ready` checks database connectivity; `/health/version` identifies the Elysia
framework, Bun runtime and `BUILD_REVISION` baked into the image.

The GitHub Actions repository variable `DOKPLOY_DEPLOY_PAUSED=true` publishes a candidate image
tagged with the commit SHA while skipping both `:latest` and the deployment webhook. Keep this
pause until the runtime below is validated, then clear it and manually dispatch the workflow for
the same reviewed commit. Image publication alone does not mean production has changed.
Set `DOKPLOY_DEPLOY_WEBHOOK` to this Compose project's webhook and the repository variable
`BACKEND_PUBLIC_URL` to the API origin. The release workflow waits for the expected commit at
`/health/version` and a successful database readiness check before reporting success.

Use this installation and cutover runbook for the dedicated Dokploy Compose project
`trading-elysia-backend`, service `backend`. Select **regular Docker Compose mode**, not Swarm
stack mode. Dokploy 0.31.1's Application
[service builder](https://github.com/Dokploy/dokploy/blob/v0.31.1/packages/server/src/utils/builders/index.ts)
reconstructs `ContainerSpec` without the custom security settings; a manual Swarm patch would
be lost on redeployment. The runbook describes the required validation, not a deployment result.

The versioned deployment files are:

- [`deploy/compose.yml`](deploy/compose.yml): one non-root backend on the external, attachable
  `dokploy-network`, with a read-only root filesystem, temporary `/tmp`, `cap_drop: ALL`,
  `no-new-privileges`, `BACKTEST_SANDBOX=bwrap`, and a database readiness health check. Set `BACKEND_IMAGE`
  to the reviewed GHCR digest for initial validation; the default is `:latest` for subsequent
  webhook releases.
- [`deploy/trading-elysia-sandbox.apparmor`](deploy/trading-elysia-sandbox.apparmor) and
  [`deploy/seccomp.json`](deploy/seccomp.json): enforcing policies permitting bubblewrap's
  namespace and mount setup. Neither privileged mode nor added container capabilities are used.
- [`deploy/docker-system-paths.json`](deploy/docker-system-paths.json): the reviewed Docker
  masked and read-only system paths. Compose uses `security_opt: systempaths=unconfined` to
  remove their overmounts, which otherwise prevent the worker from mounting its own procfs.
  The AppArmor policy instead explicitly denies access to the masked paths and writes to the
  read-only paths. These are pathname-based restrictions, a different mechanism from masking;
  AppArmor and seccomp remain enforcing, and host-wide Docker defaults remain unchanged.
- [`deploy/validate-policies.py`](deploy/validate-policies.py) checks pinned upstream hashes,
  exact seccomp additions, retained AppArmor denials and offline policy syntax without loading
  a policy. [`deploy/PROVENANCE.txt`](deploy/PROVENANCE.txt) records the source and policy changes.
- [`deploy/smoke.ts`](deploy/smoke.ts) verifies worker namespaces, empty environment, blocked
  network, hidden application files, deterministic Resin trades/signals and enforced time/CPU
  limits. It uses synthetic candles and temporary files, with no database or order writes.

Before installing policies or changing the runtime, take a fresh database backup and preserve
the old image digest, Dokploy application/environment/domain settings, Swarm specification and
Traefik configuration. Validate policy files on the target host with Python 3 and an AppArmor
parser supporting ABI 4.0, then install the reviewed files:

```bash
python3 elysia-backend/deploy/validate-policies.py
sudo install -d -m 0755 /etc/dokploy/trading-elysia
sudo install -m 0644 elysia-backend/deploy/seccomp.json /etc/dokploy/trading-elysia/seccomp.json
sudo install -m 0644 elysia-backend/deploy/trading-elysia-sandbox.apparmor /etc/apparmor.d/trading-elysia-sandbox
sudo apparmor_parser --replace /etc/apparmor.d/trading-elysia-sandbox
```

GitHub image builds **do not install or update host policies**. For every future policy change,
review and validate the new files, manually update the selected host, and revalidate the actual
image before rollout. Keep `DOKPLOY_DEPLOY_PAUSED=true` while this work is pending. A failed
policy or sandbox check blocks deployment; do not fall back to process-only strategy execution
inside the API container, which has database credentials and provider access.

First run the candidate image with these policies in a disposable container without production
credentials or network access. Run the smoke script from `/app`:

```bash
docker exec -i -w /app CONTAINER bun - < elysia-backend/deploy/smoke.ts
```

Require the isolation, namespace, system-path access and resource-limit checks to pass under
the final runtime. Transfer the existing backend environment through Dokploy's protected
configuration into the Compose `.env` file; `env_file` in the supplied configuration passes it
to the container. Preserve the database, auth secret, public auth URL and trusted origins.
Keep credentials out of Git. Attach the Compose backend to `dokploy-network`, retain the public
domain `https://194-163-189-72.sslip.io` on service `backend` port 4001, and keep metrics private.
Verify API/database access and repeat the isolation checks after container recreation to confirm
policy persistence. Point the deployment webhook at this Compose project only after validation.
Set its Dokploy command to wait for actual container health:

```text
compose -p trading-elysia-backend --env-file .env -f docker-compose.yml up -d --build --remove-orphans --pull always --wait --wait-timeout 180
```

Use a **stop-first** cutover: pause job intake, drain or cancel running backtests, stop the old
backend, and start the new backend so only one job runner/paper engine consumes shared work.
Verify migrations, revision, readiness, an authenticated market stream and an isolated backtest
before resuming traffic/jobs. Retain the old Dokploy application and Swarm service
`trading-backend-9pq2xl` stopped after cutover for rollback; stop new workers before restoring
its service/domain. Review schema compatibility before rollback. Regular Compose
does not provide Swarm's automatic rolling rollback, so coordinate this explicitly; restoring a
database backup over newer user data requires a separate recovery decision.

## Verification and performance

```bash
bun run typecheck
bun test
bun run bench:http > /tmp/trading-http-benchmark.json
```

The suite uses PGlite and fake external providers. Worker-isolation tests need process creation
and bubblewrap support; WebSocket tests need loopback sockets. The optional PostgreSQL concurrency
test runs only when `TEST_DATABASE_URL` is configured (see its test file).

`bench:http` additionally needs dependencies installed in `../backend`. It runs each backend's
actual app and market router in a separate server process, alternates execution order, warms up,
and measures throughput and p50/p95/p99 latency with matching response probes. Session validation
and cached ticker data are fixtures; database, Better Auth, providers and workers are excluded.
Terminal output is suppressed in both servers; the old Hono logger's formatting still executes.
Adjust `BENCH_DURATION_MS`, `BENCH_WARMUP_MS`, `BENCH_CONCURRENCY`, and `BENCH_ROUNDS` for longer runs.
This measures HTTP overhead, not production capacity. Compare the existing `../load/k6` workloads
against each deployed API with equivalent database state to evaluate end-to-end performance.

Local verification on November 23, 2026: **416 passed, 7 skipped, 0 failed** across 49 test files;
TypeScript and `bun install --frozen-lockfile` passed. Skips are the real-PostgreSQL concurrency
suite (including its setup/teardown hooks), because `TEST_DATABASE_URL` was not set.

A local Bun 1.4.2 / Linux x64 run used 32 concurrent clients, 1-second warmups, 3-second samples,
and 3 alternating rounds. Median throughput and median per-round p95 latency were:

| Endpoint | Hono req/s | Elysia req/s | Throughput change | p95, Hono → Elysia |
|---|---:|---:|---:|---:|
| `/health` | 32,612 | 60,102 | +84.3% | 1.669 → 0.934 ms |
| `/api/v1/market/tickers?limit=25` | 20,837 | 29,754 | +42.8% | 2.522 → 1.946 ms |

All benchmark samples had zero request errors. [Raw samples](bench/results/2026-11-23.json)
include every round and latency percentile. These are local synthetic results under the fixture
conditions above, not an end-to-end production speedup guarantee.

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

- `domain/`: business rules as pure functions (no Elysia, Better Auth, Drizzle or I/O).
- `application/`: use cases plus the ports (interfaces) they need.
- `infrastructure/`: adapters implementing those ports (Drizzle, Better Auth, SMS…).
- `http/`: native Elysia routes, request guards and response adapters.
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

## Economic calendar (`modules/calendar`)

`GET /api/v1/calendar` requires an ACTIVE session, using the same authentication as market routes.
It returns `{ items, source, sourceUrl, fetchedAt, stale, isDemo, notice }`. Items include event name,
currency, impact (`importance`: 1/2/3 or null), UTC instant or a date-only day, and actual, forecast and
previous strings (null when absent; zero remains a value).

The source is the [Forex Factory weekly JSON feed](https://nfs.faireconomy.media/ff_calendar_thisweek.json).
No credentials or migration are needed. The API shares a one-hour in-memory cache and coalesces concurrent
requests; local client filters do not generate provider calls. Failures back off for at least one minute,
or fifteen minutes on 429, honoring longer Retry-After values up to 24 hours. Saved data is served with
`stale: true` for at most 24 hours, then the API returns 503 `CALENDAR_UNAVAILABLE`. The cache is per
process and resets on restart; it is not a persistent historical archive. HTTP responses use private,
no-store caching, so session checks always run.

Coverage is the provider's published week, not a historical date-range API. Actual results may be
unavailable; no synthetic dates or numbers are substituted. The older Finance Calendar adapter under
`server/` is not used: that provider now requires an account/key. Provider information was checked on
2026-11-22 against [its current API documentation](https://www.financecalendar.com/api/).

## Crypto news (`modules/news`)

News from several free sources, stored in Postgres and served from there. User requests never reach a source, so app traffic never spends the sources' rate limits.

| Source | Kind | Key | Default poll | Notes |
|---|---|---|---|---|
| [Free Crypto News API](https://cryptocurrency.cv) | aggregator (300+ outlets) | none | 10 min | Free tier: 120 req/h; `/api/news` returns 3 items, `/api/breaking` and `/api/search` 10 each. One poll is breaking + latest + one search per topic (default 4 topics, so 36 req/h). Breaking items are flagged. |
| CoinDesk, Cointelegraph, The Block, Decrypt, CryptoSlate | RSS | none | 10 min | Publishers' own feeds (`DEFAULT_RSS_FEEDS` in `modules/news/index.ts`). |
| [CryptoPanic](https://cryptopanic.com/developers/api/) | aggregator, coin-tagged | `CRYPTOPANIC_API_KEY` | 60 min | Only polled when a key is set. Free plans are small, so check yours and set the interval to match. |

All endpoints require an ACTIVE user.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/news?limit=20&cursor=&asset=BTC&publisher=coindesk&q=etf` | Newest first. Filters combine. `q` is Postgres full-text search (web-search syntax). `nextCursor` pages stably while new articles arrive. |
| GET | `/api/v1/news/breaking?limit=10` | Stories flagged as breaking in the last 24 h. |
| GET | `/api/v1/news/sources` | Each source's status (`ok`/`failing`/`pending`), last success and next poll. Error details stay in the server log. |

An article looks like this: `{ id, title, summary, url, imageUrl, author, publisher: { key, name }, publishedAt, assets: ["BTC"], categories, breaking, sources: ["coindesk", "cryptocurrency-cv"] }`.

**How it works.**
- **Scheduling in Postgres.** Each source has one queued `news.poll` job, and each poll queues the next. The schedule lives in `news_sources.next_run_at`, and only the job whose time matches may record a poll. Any number of API and worker processes therefore share one schedule. Duplicate jobs are skipped, and a broken chain is repaired every 5 minutes.
- **Back-off.** On failure the poll interval doubles, up to 8×, and a source's `Retry-After` is honoured.
- **One row per story.** Articles are de-duplicated by canonical URL (no `www.`, tracking parameters, fragment or trailing slash). The same story from an aggregator and from the publisher's feed is one row: the first source keeps its title, and later ones add missing fields, coin tags and the breaking flag.
- **Coin tags.** `assets` holds coin codes detected from names and capitalised tickers, conservatively: "optimism" is not OP, and "BTCUSDT" is not BTC. Filter an instrument page by its base asset.
- **Hygiene.** The aggregator's data rows (gas price, hashrate) and its non-crypto mainstream stories are dropped. HTML is stripped from text. Only http(s) links are stored. Feeds are parsed without DTDs or entity expansion, with a 5 MB response cap and a 15 s timeout.
- **Retention.** Articles older than `NEWS_RETENTION_DAYS` (30) are deleted.

## Community (`modules/community`)

Traders post market findings, optionally tagged with an instrument and an image. Others can like, save, comment, reply, report and follow. All endpoints except images require an ACTIVE user. Base path: `/api/v1/community`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/feed?tab=foryou\|editors\|following\|saved&limit=20&cursor=&author=<userId>&symbol=BTCUSDT&exchange=` | Newest first (`saved` is ordered by when the post was saved). `author` and `symbol` narrow any tab. Returns `{ posts, nextCursor }`. |
| POST | `/posts` | `{ content, symbol?, exchange?, image? }` → 201 `{ post }`. `symbol` accepts `btc/usdt`, `BTC-USDT` and similar spellings, and must be an active instrument. If `exchange` is left out, every exchange is searched. `image` is a base64 data URL (JPEG/PNG/WebP/GIF, up to 1.5 MB). |
| GET | `/posts/:id` | `{ post, comments, nextCommentCursor }`, with comments oldest first. |
| GET | `/posts/:id/comments?cursor=&limit=100` | More comments. |
| PATCH / DELETE | `/posts/:id` | Edit `{ content }` (sets `editedAt`) or delete. Author only. |
| PUT / DELETE | `/posts/:id/like`, `/posts/:id/bookmark` | Like or save, and undo. Idempotent. Like returns `{ liked, likeCount }`. |
| POST | `/posts/:id/comments` | `{ content, parentId? }` → 201 `{ comment }`. A reply's parent must be on the same post. |
| DELETE | `/comments/:id` | The comment's author or the post's author. Replies are deleted with it. |
| POST | `/posts/:id/report` | `{ reason, details? }`. `reason` is `SPAM`/`HARASSMENT`/`MISLEADING`/`INAPPROPRIATE`/`OTHER` or the app's label. Reporting again only updates the reason. |
| GET | `/users/:id` | `{ user, postCount, followerCount, followingCount, following }` |
| PUT / DELETE | `/users/:id/follow` | Follow or unfollow. Idempotent. |
| GET | `/api/v1/community-images/:id` | A post's image. No session is needed, because the app's image component can't send one; ids are random UUIDs. |

A post looks like this: `{ id, content, imageUrl, symbol, exchange, likeCount, commentCount, createdAt, editedAt, liked, bookmarked, following, isEditorsPick, isOwn, hidden, author: { id, username, displayName, avatarUrl } }`.

**Rules.**
- **Counts are kept by Postgres triggers** on likes and comments, so they stay correct after cascades (deleted user, deleted parent comment).
- **Moderation.** A post reported by `AUTO_HIDE_REPORTS` (5) different users is hidden. Only its author still sees it, with `hidden: true`, and its image stops being served. Unresolved reports sit in `community_reports` (`resolved_at IS NULL`). There is no moderator API yet. Editors' picks are set directly in the database (`community_posts.is_editors_pick`).
- **Rate limits.** 10 posts and 60 comments per user per hour, counted in Postgres (`RATE_LIMITS`) → 429 `RATE_LIMITED`.
- **Hygiene.** Text is stored as plain text, with control and bidi-override characters removed. Image formats are detected from the file's bytes, not the declared type, and SVG is refused. Avatars are only returned if they are http(s). Request bodies are capped at 2.5 MB for new posts and 32 KB for everything else.
- **Deleted or suspended accounts** disappear from feeds, posts, comments and follower counts at once. Their rows are removed by the account purge (foreign keys cascade).

## AI assistant (`modules/ai`)

A tool-using assistant on Cloudflare Workers AI. It answers market questions from observed data,
analyses charts with server-computed indicators, drafts strategies, queues reproducible historical
backtests and imported-data research, and manages virtual forward tests on live Binance data.

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
- data cards: `ticker`, `market_list`, `market_analysis`, `chart`;
- `strategy_draft`: the validated definition plus a plain-language summary;
- `backtest_result`: an explicitly requested short, unsaved preview;
- `research_run`: an owned saved backtest, research experiment or live paper instance;
- `disclaimer`.

Cards are built from tool results, not model text, so they always show observed values.

**Tools.** Tool gateways enforce the authenticated user's ownership; the model cannot choose a user id.

| Purpose | Tools |
|---|---|
| Market data and charts | `search_symbols`, `get_tickers`, `get_top_movers`, `analyze_market`, `show_chart` |
| Strategy and capability discovery | `get_backtesting_capabilities`, `draft_strategy`, `list_strategies`, `get_strategy` |
| Saved historical testing | `resolve_backtest_period`, `run_backtest`, `get_backtest`, `list_backtests`, `manage_backtest` |
| Imported data and research | `list_backtest_datasets`, `inspect_backtest_dataset`, `import_backtest_dataset`, `run_research`, `get_research`, `list_research`, `cancel_research` |
| Virtual live accounts | `list_paper_accounts`, `create_paper_account`, `get_paper_account` |
| Live forward tests | `start_live_test`, `get_live_test`, `list_live_tests`, `control_live_test` |
| Manually recorded holdings | `get_my_holdings` |

`show_chart` draws up to 150 candles, using 50 earlier candles to warm moving averages. Replies allow
two charts, six tool rounds, five calls per round and three newly submitted tests. Repeated identical
mutation calls in the same answer reuse their first result. Invalid arguments return an explicit
tool error. Large reports remain valid JSON and disclose any omitted rows; chart/trade previews
must not be interpreted as complete samples.

**Historical requests.** `run_backtest` defaults to `mode: 'saved'`, taking an owned saved
`strategyId`/optional immutable `strategyVersionId`, a current-turn `draftId`, or a full supported
definition. A draft is validated and saved before its job is queued. Requested symbol/timeframe,
capital, sizing, commission, slippage, spread/volume scenarios and optional statistical sampling
settings are passed to the engine. Dates use `[start,end)` with explicit timezone offsets or UTC
milliseconds. `resolve_backtest_period` uses native Temporal to resolve calendar dates in the user's
timezone, including daylight-saving changes; ambiguous/nonexistent midnights require explicit offsets.
The assistant explains the resolved interval;
future, empty, conflicting or oversized ranges are rejected instead of silently shortened.

Saved runs accept 100–50,000 scored candles, with indicator warm-up loaded separately. The default
is the last 1,000 closed candles, 10,000 quote-currency capital, 0.1% commission per side, one tick
slippage and strategy position size; effective assumptions must be disclosed. Choose a date range
or a candle count. `mode: 'preview'` is an explicit unsaved check limited to 3,000 candles and a
15-second worker timeout. Its response includes effective settings and execution assumptions.

A queued card means **pending**, not a completed performance estimate. The mobile card refreshes
from the owned resource endpoint and opens the full result or live-instance screen. Run identifiers
and saved/unsaved strategy references are included in later conversation context, so “show its
results” or “replay that run” can retrieve real state. A draft id itself is local to its original turn.
Saved inputs and engine identity support exact replay; cancel and replay require the user's request.

**Data and research boundaries.** Automatic historical fetching currently uses Binance public spot
candles. NSE/BSE equities/options require an actual owned imported dataset. Dataset inspection reports
provenance, instrument lifetimes, candle/quote coverage, sessions, dated fees, margins and settlement
coverage without returning all rows. Imports must preserve user-supplied values; the model must not
invent missing history, rates, margins or calendars. Large documents belong in the Research workspace.
Walk-forward research accepts up to eight explicit candidates and ten disjoint held-out windows.
Its explicit `objective` is `total_return` (default), `min_drawdown`, `sharpe` or `sortino`. Ratio
objectives require a supplied annual sampling convention and fail when a candidate/window's ratio
is undefined. Chat summaries preserve OOS scores, selected candidate, dates and training scores. Test-window
returns are separate fresh-account evaluations and must not be added into a portfolio return.
Quote research replays supplied timestamped orders against observed bid/ask/size data.

**Supported strategies are finite.** The rule language supports one instrument, one timeframe and
one direction per strategy, with up to five AND entry conditions and five OR indicator exit
conditions. PRICE means candle close. Historical LONG/SHORT, fixed stops/targets, trailing stops,
partial exits and pyramiding are supported. Arbitrary Python/Pine, custom indicators, nested Boolean
rules, multi-symbol/multi-timeframe indicator strategies, time-of-day entries, news/sentiment signals,
automatic option strike/Greek selection and exchange queue-position simulation are not supported.
The AI must report an unsupported rule and preserve the user's intended rules rather than silently
substituting a simpler strategy. No AI tool places real-money orders.

Example requests:

- “Backtest my saved EMA strategy on BTCUSDT 1-hour candles from 1 October 2026 00:00 UTC to 1 November 2026 00:00 UTC, using 25,000 USDT, 0.05% commission per side and two ticks of slippage.”
- “Using my imported stock dataset, compare the two specified EMA candidates by minimum drawdown, with 300 training bars, 100 test bars and a one-bar embargo; show each held-out window.”
- “Start my saved LONG strategy on live BTCUSDT 5-minute candles in my Practice paper account.”
- “Run that live paper test for 60 minutes, then stop it and try to close its remaining position.”
- “Show the saved test's results and assumptions, then replay its archived input.”

Live tests use virtual funds and future observed candles. Starting one requires an explicit live/
forward/paper-testing request and an owned account, or explicit virtual capital for a new account.
They support LONG, one position, fixed protective exits and indicator exits; advanced historical
features are rejected. Account performance can include multiple strategies, so it is not automatically
one instance's P/L. Pause, resume and stop are user-requested controls; stopping leaves positions
open unless closing them is requested. See the paper-trading section for lifecycle and fill details.

Timed live starts accept `endTime` (an ISO timestamp with offset or UTC milliseconds) or
`durationMinutes` (1–525,600), at most 365 days ahead. Use `closePositionAtEnd: true` only when the
user requests closing exposure; its default is false. Duration becomes a fixed deadline when the
start request is handled; runner initialization does not reset it. Expiry prevents new strategy entries and the
engine's approximately 15-second sweep marks expired instances stopped even if no candles arrive;
paused instances expire too. Optional closing uses an observed fresh quote, not an invented price
at the deadline. Inspect `termination.closeStatus` and its message: a failed close leaves the
position open, while existing protective orders can remain active. A stopped instance alone is
not evidence that its position closed.

**No raw strategy code.** The assistant explains strategies in plain words with a chart. It never gives JSON, Pine Script or other code, even if asked. The prompt asks for this, and `domain/code-filter.ts` enforces it: fenced code blocks are removed from replies while they stream, and the message is marked `metadata.codeRemoved`. Smaller models sometimes copy a tool's argument format into their answer, which is why the filter is needed. `draft_strategy` still runs, so the definition is validated and kept for saving, but only as a card.

**Providers.**
- **Adding one:** implement `ChatModelProvider` (`application/ports.ts`) and add `ModelProfile`s, as `WorkersAiProvider` and `WORKERS_AI_MODELS` do.
- **Workers AI:** uses the OpenAI-compatible endpoint. The default is `gpt-oss-120b`, with `reasoning_effort: low` and a 4096-token budget that covers its hidden reasoning. When the default fails before producing output, it falls back to `llama-4-scout`, then `mistral-small-3.1`. In a live comparison on 2026-11-12, gpt-oss-120b was the only Workers Free model that called every tool correctly and refused to write code. GLM-5.3 and DeepSeek V4.1 need the Workers Paid plan.
- **Persona:** the user's AI preferences (style, explanation level, language) and timezone shape the system prompt.

**Usage and cost.** Every model call is a row in `ai_usage_events` with tokens, Cloudflare neurons, latency, model and status. Daily per-user limits (`AI_DAILY_TURN_LIMIT`, `AI_DAILY_TOKEN_LIMIT`) are checked against it. Measured live: about 150 to 200 neurons per question, while the Workers AI free allowance is 10,000 neurons a day per account.

## Strategies (`modules/strategies`)

`GET /api/v1/strategies`, `GET /api/v1/strategies/:id`, `POST /api/v1/strategies`. A definition (engine `v1`) is:
- a market (exchange, symbol, timeframe) and LONG or SHORT direction;
- entry conditions (all must hold) and exit conditions (any one is enough), built from PRICE, VOLUME, SMA, EMA, RSI, MACD and BOLLINGER with GT, LT, CROSSES_ABOVE and CROSSES_BELOW;
- fixed stop/target percentages, optional trailing stops and up to five partial profit targets;
- optional pyramiding from one to ten entries (historical testing only above one);
- position size.

Versions are immutable (`strategy_versions`). AI drafts are saved with `source: AI_GENERATED`.

## Backtesting (`modules/backtesting`)

The current adapter version is `2`. Generated LONG and SHORT strategies support entry pyramiding,
fixed stops/targets, trailing stops and partial profit-taking. Protective orders attach at the
actual entry fill before the candle path is simulated. Ordinary signals execute only on bar close;
fill-time recalculation cannot reuse the completed candle's future indicator values.

Each run loads a separate pre-start warm-up prefix (five times the longest indicator lookback,
at least 50 bars). No orders or reported performance occur during warm-up. This is finite indicator
initialization, not a claim that recursive indicators have an infinite history.

Migration `0014_backtest_artifacts.sql` adds append-only dataset/input snapshots and research runs.
Apply with `bun run db:migrate` before starting the updated application. Snapshots are stored before
execution, reused on retry and retained independently of `market_candles`. Exact replay checks both
the pinned Resin revision and application adapter version; a different engine requires a new run.

Additional authenticated endpoints:

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/v1/backtests/:id/dataset` | Owner-only archived engine input and canonical checksum |
| POST | `/api/v1/backtests/:id/replay` | Queue a new run using the archived input |
| POST | `/api/v1/backtests/datasets` | Validate and retain an immutable historical dataset |
| GET | `/api/v1/backtests/datasets` | Compact summaries and instrument/timeframe ranges |
| GET | `/api/v1/backtests/datasets/:id` | Retrieve an owned dataset |
| POST | `/api/v1/backtests/experiments` | Queue single, walk-forward or quote portfolio research |
| GET | `/api/v1/backtests/experiments` | Recent owned experiments |
| GET | `/api/v1/backtests/experiments/:id` | Status, result and declared assumptions |
| POST | `/api/v1/backtests/experiments/:id/cancel` | Cancel pending/running research |

Imports are JSON, at most 16 MiB each and 20 retained datasets per account. The schema is in
`datasets/import.ts`. It includes sourced/licensed provenance, instrument lifetimes, raw decimal
prices, candles, observable quotes/trades, explicit dated sessions, corporate actions, effective
fee schedules, historical portfolio-margin snapshots and expiry settlements. Importing a dataset
does not modify the shared live-market catalog. An omitted session inside declared calendar
coverage is a closed market; missing coverage is an error. No holiday calendar, tax rate or margin
schedule is guessed. Calendar intervals are `[openTime, closeTime)`; candle close times are inclusive.

For candle research submit `{ kind: 'single' | 'walk_forward', datasetId, instrumentId, timeframe,
range: { start, end }, definitions: [definition], settings? }`. Walk-forward additionally requires
`walkForward: { trainBars, testBars, embargoBars, stepBars?, anchored? }`. Supply up to eight candidate
definitions; parameters maximize training total return before evaluation on disjoint later test
windows by default. Optional `objective` chooses `total_return`, `min_drawdown`, `sharpe` or `sortino`.
Sharpe/Sortino require explicit `riskStatistics`; unavailable or non-finite ratios fail with a reason
rather than being treated as zero. Minimum-drawdown ranking maximizes the negative candle-close
`maxDrawdownPercent`; `rankingScore` labels that utility and `objectiveValue` retains actual drawdown.
The legacy `score` field equals `rankingScore`. Each test window starts a fresh account, so window percentages are not added into a
portfolio return. Sensitivity reports cover the first training window only. Imports require a
complete candle grid, including pre-start warm-up. Raw corporate actions spanning indicator history
must be handled explicitly; adjusted data must have a suitable point-in-time cutoff for each window.
Training/sensitivity retain summary metrics; single/test results include at most 500 trade previews
with `tradesTruncated` and the full trade count. Reported metrics always use all trades. Quote curves
are downsampled after accounting, and experiment results are limited to 16 MiB to bound memory/storage.

Optional top-level `riskStatistics: { periodsPerYear, annualRiskFreeRate? }` adds Sharpe, Sortino,
CAGR and volatility to candle runs. Supply the actual trading-period sampling frequency; it is not
inferred for irregular observations. Metrics use the full curve before downsampling. Short samples
can produce unstable annualized statistics. Undefined ratios and ratios on incomplete candle grids
are returned as null.

Quote portfolio replay uses `{ kind: 'options', datasetId, execution }` (the name also supports
equities and crypto). `execution` contains `start`, `end`, `initialCapital` and timestamped `orders`:
`{ id, time, legs: [{ instrumentId, side: 'BUY' | 'SELL', lots }], timeInForce?: 'FOK' | 'IOC',
limitNetDebit? }`. Optional execution inputs include quote/margin maximum age, latency, slippage,
size participation and initial holdings. See `market-models/options.ts` for the full validation schema.
Generate a small synthetic import with `bun src/scripts/backtest-fixture.ts` and use it in the app's
Research screen; it is explicitly not historical market data or a real fee schedule.

Quote replay uses receive-time-available bid/ask prices and consumes displayed size. It applies
dated fees, shared cash, supplied short-portfolio margins, dividends/splits and funded cash/physical
expiry settlement. Missing quotes, required margins or settlement inputs fail explicitly. Margin
breaches halt with `MARGIN_BREACH`; no liquidation price, financing or auction outcome is fabricated.
Basket legs are atomic simulation units, not a promise of simultaneous exchange execution. This is
historical order replay, not an options-selection algorithm or an exchange margin calculator.
The portfolio engine also runs in a resource-limited OS sandbox. Research is limited to three active
runs per account, ten walk-forward windows per run and a four-minute overall execution budget.

Execution settings `spreadTicks` and `maxVolumeParticipationPercent` are explicitly modeled stress
scenarios for candles, using the previous closed bar's volume. They do not claim observed market
depth. Keep candle-close drawdown separate from `intrabarMaxDrawdown`, which follows the declared
OHLC path and modeled fills. Real queue position and unobserved market impact cannot be reconstructed
from OHLC or top-of-book snapshots. Resin indicator/execution arithmetic uses float64 with tick/lot
representability checks; normalized reporting and quote-portfolio cash accounting use decimals.

Validation commands: `bun test tests/backtesting` and `bun run typecheck`. To verify concurrent
database behavior use an empty disposable database named with `backtest_test`:
`BACKTEST_DATABASE_URL=postgres://.../backtest_test bun test tests/backtesting/postgres.test.ts`.
The mobile workspace is available through Profile → Backtesting and AI backtest cards; research,
history, comparison, archived-data inspection and replay are included.

Runs a saved strategy version over stored historical candles. **Resin** (Pine Script v5/v6, Apache-2.0) is the first engine behind the `BacktestEngine` interface (`engines/backtest-engine.interface.ts`). It is pinned to commit `fa683a0` (v0.3.0) from GitHub, not npm; see `poc/resin/FINDINGS.md`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/backtests` | `{ strategyId, strategyVersionId?, market?, range?: { start?, end? }, candles?, settings?, riskStatistics? }` → 202, queued; choose range or candles |
| GET | `/api/v1/backtests?limit&before&status&strategyId` | The user's backtests, newest first |
| GET | `/api/v1/backtests/:id` | Status, summary metrics, settings, engine, dataset, warnings, script |
| GET | `/api/v1/backtests/:id/trades?limit&offset` | Paginated trades |
| GET | `/api/v1/backtests/:id/equity-curve?maxPoints` | Equity curve (min/max-preserving downsample) |
| POST | `/api/v1/backtests/:id/cancel` | Cancel a queued or running backtest |
| POST | `/api/v1/backtests/preview` | Unsaved `definition`, optional `market`, `range` or `candles`, `settings`, `riskStatistics`; no run is stored |

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
| POST | `/api/v1/paper/strategies/:id/start` | `{ accountId, strategyVersionId?, symbol?, timeframe?, endTime?, durationMinutes?, closePositionAtEnd? }`. Runs a saved strategy automatically; endTime and durationMinutes are alternatives. |
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

## Morning Decode generation

Morning Decode uses OpenRouter with `nvidia/nemotron-3-ultra-550b-a55b:free` for the script and
`hexgrad/kokoro-82m` with voice `af_heart` for MP3 audio by default. Set `OPENROUTER_API_KEY` on
the backend. `MORNING_DECODE_SCRIPT_PROVIDER`, `OPENROUTER_SCRIPT_MODEL`, `OPENROUTER_TTS_MODEL`,
and `OPENROUTER_TTS_VOICE` override those defaults; keep the voice compatible with the speech model.
The text request allows 6,000 output tokens because Nemotron's reasoning shares the output budget.

Run `bun run morning-decode:generate` to ensure today's UTC briefing exists, or add `--force` to
regenerate it. Forced generation preserves the existing briefing until both a new script and audio
succeed, then replaces the row atomically. A missing audio result exits with an error.
To copy the generated briefing into another database, set `TARGET_DATABASE_URL` and add `--publish`;
publishing atomically inserts or updates that UTC day's row. Neither command restarts the API.

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
| `NEWS_RSS_ENABLED` / `NEWS_RSS_INTERVAL_MINUTES` | `true` / `10` | Publisher RSS feeds. |
| `NEWS_CRYPTOCURRENCY_CV_ENABLED` / `NEWS_CRYPTOCURRENCY_CV_INTERVAL_MINUTES` | `true` / `10` | Free Crypto News API (120 req/h free). |
| `NEWS_CRYPTOCURRENCY_CV_TOPICS` | `bitcoin,ethereum,solana,xrp` | One search request per topic per poll. |
| `CRYPTOPANIC_API_KEY` | unset | Enables CryptoPanic. Secret: it is never logged. |
| `NEWS_CRYPTOPANIC_INTERVAL_MINUTES` / `CRYPTOPANIC_API_URL` | `60` / `https://cryptopanic.com/api/developer/v2` | |
| `NEWS_RETENTION_DAYS` | `30` | |
