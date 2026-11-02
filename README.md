# TradingGurukul — Forex & Crypto Markets

Mobile-first market app for **forex and crypto**, with USD paper trading. Includes Markets, Community, AI Assistant, and Profile. Inspired by TradingView / Binance Square UX, built with **Expo SDK 58** + a separate **Express** API.

## Structure

```
trading-app/
  app/       # Expo React Native client (Expo Router)
  server/    # Express + Bun + Drizzle (SQLite) API
```

## Features

- **Markets** — Watchlist / Explore / Overview (forex and crypto)
- **Charts** — TradingView Lightweight Charts (candle / line / area, multi-timeframe, MA/EMA/RSI/MACD/BB)
- **Paper trading** — Virtual USD balance for USD/USDT-quoted crypto and forex pairs, fractional quantities (no real brokerage orders)
- **Community** — For You / Editors’ Picks / Following, posts, likes, comments, follows, bookmarks, reports
- **AI Assistant** — Cloudflare Workers AI streaming chat, market analysis, portfolio insights
- **Profile** — Overview, portfolio dashboard, settings

## Quick start

### 1. Backend

```bash
cd server
cp .env.example .env
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

API: `http://localhost:4000`  
Demo login: `demo` / `password123`

### 2. Mobile / web client

```bash
cd app
cp .env.example .env
# Set EXPO_PUBLIC_API_URL=http://localhost:4000
# Android emulator: http://10.0.2.2:4000
bun install
bunx expo start
```

## Environment variables

### UI preview with sample data

Set `EXPO_PUBLIC_DEMO_MODE=true` in `app/.env` and restart Expo to preview the app without the API. A sample account opens automatically with populated markets, price charts, holdings, transactions, community posts, and AI conversation history. The app displays a demo banner; prices and AI answers are fictional.

Watchlist, community, and profile edits stay in memory and reset on a full reload. Saved real credentials and backend data are untouched. Order placement and password changes display a preview-only message. The full advanced chart still loads its existing chart library from a CDN.

Set the flag to `false` and restart Expo to return to the real API. Missing market data in live mode never activates dummy data automatically.

### Server (`server/.env`)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Auth signing |
| `DEFAULT_PAPER_BALANCE` | Starting virtual cash in USD (default `100000`) |
| `TWELVE_DATA_API_KEY` | Forex quotes and candles (server only) |
| `TWELVE_DATA_MINUTE_CREDITS` / `TWELVE_DATA_DAY_CREDITS` | Per-process rolling quotas, default 8 / 800 |
| `FOREX_POLL_MS` / `FOREX_HISTORY_CACHE_MS` | Quote refresh (60s) / history cache (5min) |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_AI_MODEL` | Cloudflare Workers AI |

Crypto uses Binance public market data without an API key. Set `TWELVE_DATA_API_KEY` for forex. Missing forex configuration leaves crypto usable and displays a forex availability message.

Without Cloudflare credentials AI Insight shows a setup error; it does not save a canned response as an AI answer.

### App (`app/.env`)

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_URL` | Backend base URL |

## API overview

| Prefix | Module |
|--------|--------|
| `GET /health` | Health + market provider |
| `/api/auth` | Register, login, refresh, logout, me |
| `/api/market` | Search, quote, candles, explore, overview, movers |
| `/api/watchlists` | Multi-watchlist CRUD + items |
| `/api/trading` | Portfolio, orders, transactions (paper) |
| `/api/community` | Feeds, posts, likes, comments, follows, bookmarks, reports |
| `/api/ai` | Streaming chat (SSE), suggestions, conversations |
| `/api/users` | Profile overview, settings, password |
| Socket.IO | exchange-qualified `subscribe` / `quote`, `subscribe-candles` / `candle`, `market-status` |

## Market data

Forex uses [Twelve Data](https://twelvedata.com/docs) quotes and UTC candles. Crypto uses Binance REST for initial snapshots/history and a shared [Binance WebSocket](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams) for live tickers and active chart candles. Public crypto feeds need no API key. The backend uses `https://data-api.binance.vision/api/v3` and `wss://stream.binance.com:443/stream`.

Supported primary instruments: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT; EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD. Prices show their actual quote currency and precision; USDT is distinct from USD. Crypto mini-charts cover a rolling day and forex uses UTC sessions.

Duplicate requests share cached responses. Twelve Data requests obey the configured per-process rolling minute/day budgets (one credit per symbol/request). At the default daily budget, continuous monitoring can exhaust the allowance before the day ends; increase limits only to match your plan. Multiple server instances need shared quota coordination, which is not included. A stale quote retains its original observation time; missing data never becomes a generated price. Missing credentials and exhausted budgets are visible in market availability. Socket connections recover automatically and unsubscribe when unused; React Query caches receive batched updates without per-tick HTTP refetches.

Paper accounts settle in **USD**. Crypto pairs (USDT treated 1:1 with USD for simulation) and EUR/USD, GBP/USD, AUD/USD, NZD/USD are tradable. USD/JPY, USD/CHF and USD/CAD are market-data only and return `UNSUPPORTED_ACCOUNT_CURRENCY`, because they are quoted in a non-USD currency. No broker order API is called.

**Upgrading an existing database:** the first `db:migrate` (or server start) after this release removes all Indian-market data — NSE/BSE/MCX watchlist items and post tags — clears INR orders, positions and transactions, and resets every paper account to `DEFAULT_PAPER_BALANCE` USD. Back up `server/data/trading.db` first if you need the old records.

Set `EXPO_PUBLIC_DEMO_MODE=false` and restart Expo to use real data. Explicit demo preview contains fictional forex/crypto markets and a sample USD portfolio.

## AI (Cloudflare Workers AI)

AI Insight calls the authenticated Express endpoint `POST /api/ai/chat`, which uses the Cloudflare Workers AI REST API and streams the response to the app. No separate Worker deployment is needed. Account IDs and API tokens stay on the backend; never put them in `EXPO_PUBLIC_*` variables.

1. Keep your Cloudflare account on **Workers Free** for a hard free-tier ceiling.
2. In Cloudflare Dashboard → **Workers AI → Use REST API**, create a Workers AI API token and copy your account ID. Custom tokens need **Workers AI Read and Edit** permissions for that account ([Cloudflare setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)).
3. Set these values in `server/.env`:

   ```dotenv
   CF_ACCOUNT_ID=your-account-id
   CF_API_TOKEN=your-workers-ai-token
   CF_AI_MODEL=@cf/meta/llama-3.2-3b-instruct
   ```

4. Restart the backend with `cd server && bun run dev`. Keep `EXPO_PUBLIC_DEMO_MODE=false` in `app/.env`; restart Expo if you changed that flag.
5. Sign in, open **AI Insight**, and send a chat message. Market and Portfolio modes use the same model with backend market/portfolio context.

The default [Llama 3.2 3B model](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/) supports streaming chat. Requests include at most the latest 12 conversation messages, generate at most 512 tokens, and time out after 60 seconds. Stopping a response or leaving the screen aborts the upstream request. Completed answers are saved; failed or interrupted answers are not saved as successful replies.

Cloudflare provides **10,000 Neurons per account per day**, resetting at **00:00 UTC**. This is shared usage, not a fixed number of messages. On Workers Free, further requests fail after the allowance is exhausted. A Workers Paid account can incur charges above the allowance; this app does not enforce account-wide billing limits. See [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

The app distinguishes daily exhaustion from temporary rate/capacity limits and reports invalid credentials or paid-only model selection. Check the Workers AI dashboard for actual usage. Provider tests use mocked Cloudflare responses; a live smoke test requires valid backend credentials.

## Testing checklist

1. Login as `demo` / `password123`
2. Markets → Watchlist / Explore / Overview
3. Place a paper BUY via `POST /api/trading/orders` (e.g. `{"symbol":"BTCUSDT","side":"BUY","orderType":"MARKET","quantity":0.01}`)
4. Profile → Portfolio shows position + cash change
5. Community → create post, like, comment
6. AI → ask about BTCUSDT or EUR/USD (requires backend CF credentials)
7. Settings → edit profile, logout

## Credential-gated features

| Feature | Requires |
|---------|----------|
| Forex quotes & candles | `TWELVE_DATA_API_KEY` |
| Crypto quotes & candles | Public Binance connectivity |
| Live AI responses | `CF_ACCOUNT_ID` + `CF_API_TOKEN` |
| Advanced Charts / Charting Library | Not used (Lightweight Charts only) |

## Notes

- This is **paper trading only** — educational simulation.
- Not investment advice. Disclaimers are shown in AI responses.
