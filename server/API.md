# Trading API

Base URL: `http://localhost:4000`

Auth: `Authorization: Bearer <accessToken>` on protected routes.

## Auth

- `POST /api/auth/register` `{ email, username, password, displayName? }`
- `POST /api/auth/login` `{ emailOrUsername, password }`
- `POST /api/auth/refresh` `{ refreshToken }`
- `POST /api/auth/logout` (auth) `{ refreshToken? }`
- `GET /api/auth/me` (auth)

## Market

- `GET /api/market/status`
- `GET /api/market/search?q=`
- `GET /api/market/quote/:symbol?exchange=BINANCE`
- `POST /api/market/quotes` `{ symbols: [{ symbol, exchange? }] }`
- `GET /api/market/candles/:symbol?timeframe=1d&exchange=FOREX`
- `GET /api/market/overview`
- `GET /api/market/movers`
- `GET /api/market/explore`

Primary exchanges are `BINANCE` and `FOREX`. For example:

- `/api/market/quote/BTCUSDT?exchange=BINANCE`
- `/api/market/candles/EUR%2FUSD?exchange=FOREX&timeframe=5m`

Supported crypto: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT. Forex: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD. `EURUSD` and `BTC/USDT` aliases normalize to canonical symbols. An omitted exchange resolves any supported pair; explicit exchanges are respected. Any other symbol or exchange returns `400 INVALID_INSTRUMENT`.

Quotes include `source`, `asOf` (Unix seconds), `currency`, `pricePrecision`, `assetClass`, and optional `stale`/`marketOpen`. Candle responses include `{ candles, isDemo, source, currency, pricePrecision }`; OHLCV times are Unix seconds. Sources are `twelvedata`, `binance`, `angelone`, or `yahoo`. `liveOnly=true` excludes generated prices; it does not guarantee real-time availability. Forex volume is zero because this feed does not provide centralized traded volume.

`explore` and `overview` include `crypto`, `forex`, and separate `availability` messages. Primary movers rank this curated universe. Crypto activity is ranked within crypto only. Partial provider failures leave working markets visible. News and events remain empty without a real source.

Twelve Data is configured with `TWELVE_DATA_API_KEY`. Requests use server-side shared caches (quotes default 60 seconds, history 5 minutes) and rolling credit ceilings (`TWELVE_DATA_MINUTE_CREDITS=8`, `TWELVE_DATA_DAY_CREDITS=800`). Each symbol request costs one credit. Concurrent quote requests are scheduled ahead of background history. Exhausted budgets return a stale last quote if available or a clear 503; the observation time never advances artificially. Limits are per process; production replicas require shared quota coordination. Configure `FOREX_POLL_MS` (minimum 15000) and `FOREX_HISTORY_CACHE_MS` (minimum 60000) to fit your plan. No forex background polling occurs without a key and subscribers.

Binance public REST supplies initial snapshots/history and exchange precision metadata. REST quotes cache for 10 seconds, history for 30 seconds, exchange metadata for one hour. Active full charts use `fresh=true` to bypass the history snapshot cache; simultaneous fresh requests still coalesce. Client-side reconciliation keeps bars received during a history request and preserves newer stream observations. One combined WebSocket supplies subscribed ticker/kline updates; it reconnects with bounded backoff, detects silence and rotates before the 24-hour connection limit. The Bun WebSocket client handles protocol ping/pong frames. Crypto trading hours are 24/7; this does not imply the connection is healthy.

Unavailable batch quotes are omitted; watchlist entries retain `quote: null` even when all quotes fail. A direct quote/candle request fails rather than fabricating data. Portfolio valuation fails if a position has no quote.

## Watchlists (auth)

- `GET /api/watchlists`
- `POST /api/watchlists` `{ name }`
- `DELETE /api/watchlists/:id`
- `GET /api/watchlists/:id/items`
- `POST /api/watchlists/:id/items` `{ symbol, exchange, name, token? }`
- `DELETE /api/watchlists/:id/items/:itemId`

## Trading / paper (auth)

Paper accounts settle in USD. Orders are accepted for instruments quoted in USD or USDT (all crypto pairs; EUR/USD, GBP/USD, AUD/USD, NZD/USD); USDT is treated 1:1 with USD for simulation only. USD/JPY, USD/CHF and USD/CAD are market-data only: order placement and pending execution reject `UNSUPPORTED_ACCOUNT_CURRENCY` before any fill or balance mutation. `quantity` is a positive number with up to 8 decimals (base-currency units, e.g. `0.05` BTC or `10000` EUR). Multi-currency settlement and leveraged trading are not implemented.

Upgrading from a release with Indian markets: the first migration (`PRAGMA user_version` 1) deletes NSE/BSE/MCX watchlist items, untags such posts, clears all INR orders/positions/transactions, and resets every paper account to `DEFAULT_PAPER_BALANCE` USD.

- `GET /api/trading/portfolio`
- `GET /api/trading/orders`
- `GET /api/trading/transactions`
- `POST /api/trading/orders` `{ symbol, exchange?, name?, side, orderType, quantity, limitPrice?, stopLoss?, takeProfit? }`
- `DELETE /api/trading/orders/:id`

## Community

- `GET /api/community/feed?tab=foryou|editors|following&offset=&limit=`
- `GET /api/community/posts/:id`
- `POST /api/community/posts` (auth)
- `POST /api/community/posts/:id/like` (auth)
- `POST /api/community/posts/:id/comments` (auth)
- `POST /api/community/posts/:id/bookmark` (auth)
- `POST /api/community/posts/:id/report` (auth)
- `POST /api/community/users/:id/follow` (auth)

## AI (auth, rate-limited)

- `GET /api/ai/suggestions`
- `GET /api/ai/conversations`
- `GET /api/ai/conversations/:id`
- `POST /api/ai/chat` SSE stream `{ message, conversationId?, kind?, symbol?, exchange? }`

## Users (auth)

- `GET /api/users/me/overview`
- `PATCH /api/users/me`
- `POST /api/users/me/password`
- `GET /api/users/:username`

## Socket.IO

- Client → `subscribe` / `unsubscribe`: arrays such as `["BINANCE:BTCUSDT", "FOREX:EUR/USD"]`. A bare supported symbol such as `"BTCUSDT"` resolves to its exchange; unsupported keys are ignored.
- Client → `subscribe-candles` / `unsubscribe-candles`: arrays such as `["BINANCE:BTCUSDT:5m"]`; all supported chart timeframes are accepted, including case-sensitive `1M`.
- Server → `quote`: normalized quote, only to interested rooms.
- Server → `candle`: `{ symbol, exchange, timeframe, candle, eventTime }`. `candle.time` is seconds; `eventTime` preserves Binance milliseconds for ordering.
- Server → `market-status`: `{ exchange, status }` (`connecting`, `live`, `reconnecting`, `idle`, or `unavailable`). A stream status describes connectivity, not a guarantee that every price is current; inspect `asOf`/`stale`.

Input arrays and per-client quote/candle sets are capped at 50. The crypto upstream union is bounded at 64 streams. Forex polls only subscribed instruments. Clients reference-count interests, keep a bounded union of 50 live quote keys, resubscribe on reconnect, and release listeners on unmount. Excess interests retain periodic REST snapshots with a visible live-limit label; waiting keys are promoted when capacity is released. The former global `quotes` broadcast is removed; clients should use scoped subscriptions. Active chart history is refreshed after stream reconnection and periodically to recover gaps.
