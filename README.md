# TradingGurukul — Crypto Markets & Paper Trading

Mobile-first app for **crypto markets** with USDT paper trading and an AI assistant. Built with an
**Expo SDK 58** client and a **Hono + Bun + PostgreSQL** API.

## Structure

```
trading-app/
  app/       # Expo React Native client (Expo Router)
  backend/   # Hono + Bun API, PostgreSQL via Drizzle ORM
  docs/      # Plans and research notes
```

## Features

- **Home & Market** — live Binance spot prices for USDT pairs, discovery lists, mini charts
- **Charts** — TradingView Lightweight Charts with drawing tools and indicators
- **Paper trading** — a virtual 100,000 USDT account; no real brokerage orders
- **AI Insight** — Cloudflare Workers AI chat with market tools, streamed over SSE
- **Profile** — portfolio overview, allocation, activity and settings

Community, watchlists, economic data and forex are not connected yet: the backend has no module
for them. The Community tab is hidden.

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env
bun install
bun run dev:setup    # Postgres 17 in Docker on localhost:5433, migrations, test user
bun run dev          # http://localhost:4001/health
```

The dev test user is `test@gmail.com` / `pass1234` (already active, so it skips the phone step).
See [backend/README.md](backend/README.md) for the database workflow, architecture, endpoints and
environment variables.

### 2. Mobile / web client

```bash
cd app
cp .env.example .env
# EXPO_PUBLIC_API_URL=http://localhost:4001
# Android emulator: http://10.0.2.2:4001 · physical phone: your computer's LAN IP
bun install
bunx expo start
```

See [app/README.md](app/README.md) for sign-in, which module talks to which endpoint, and building an
Android APK.

`EXPO_PUBLIC_DEMO_MODE=true` in `app/.env` previews every screen with local sample data and no
backend. Restart Expo after changing it.

## AI Insight setup

The backend calls the Cloudflare Workers AI REST API. Account IDs and tokens stay on the backend;
never put them in `EXPO_PUBLIC_*` variables.

1. In Cloudflare Dashboard → **Workers AI → Use REST API**, create an API token with **Workers AI
   Read and Edit** permissions and copy your account ID.
2. Set `CF_ACCOUNT_ID` and `CF_API_TOKEN` in `backend/.env` (models: `AI_DEFAULT_MODEL`,
   `AI_FALLBACK_MODELS`; limits: `AI_DAILY_TURN_LIMIT`, `AI_DAILY_TOKEN_LIMIT`).
3. **Restart the backend.** Bun reads `.env` only at startup, and `bun --watch` does not restart on
   `.env` edits. Without credentials the AI endpoints answer `503 AI_NOT_CONFIGURED`.

## Notes

- This is **paper trading only**: an educational simulation.
- Not investment advice. AI answers include a learning-only disclaimer.
