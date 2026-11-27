# ZRS paper trading terminal (`frontend/webapp`)

A desktop trading terminal for the TradingGurukul backend ([`../../elysia-backend`](../../elysia-backend)). It shows a live Binance chart, lets you place market, limit and stop **paper** orders, and lists your positions, open orders, fills and order history.

The mobile app's web build (`app/`, `expo start --web`) is still the full-product web client: AI, backtests, news, community and calendar. This terminal covers trading only.

**Stack:** React Router 8 in SPA mode (`ssr: false`), Tailwind 4, klinecharts 10 and Better Auth's React client.

## How it talks to the backend

Every request is **same-origin**. The browser calls relative `/api/v1/...` paths and opens `ws(s)://<host>/api/v1/market/stream`.

- **In development**, the Vite dev server proxies `/api` (including the WebSocket) and `/health` to the backend.
- **In production**, nginx in this image does the same.

The Better Auth session cookie therefore needs no CORS setup or third-party cookies.

| Area | Backend endpoints | Code |
|---|---|---|
| Auth: email/password, then phone OTP | `/api/v1/auth/*` (`sign-in/email`, `sign-up/email`, `get-session`, `phone-number/send-otp`, `phone-number/verify`, `sign-out`) | `app/lib/auth.tsx`, `app/lib/api/authClient.ts` |
| Market data | `GET /api/v1/market/{tickers,symbols,candles}`, WS `/api/v1/market/stream` (`ticker:`/`candles:` topics) | `app/lib/api/market.ts`, `app/lib/api/socket.ts` |
| Paper trading | `/api/v1/paper/accounts`, `…/portfolio`, `/orders`, `/orders/:id/cancel`, `/positions/:id/close` | `app/lib/api/paper.ts` |

New accounts land on `/verify-phone` and can trade once the backend marks them `ACTIVE`. The first visit creates a paper account named "Main" with 100,000 USDT. Sells are reduce-only (spot style, no shorting), the same as in the mobile app.

## Development

Start the backend first (see its README). It listens on `http://localhost:4001`. Then:

```bash
bun install
bun run dev          # http://localhost:5173
```

Add `http://localhost:5173` to the backend's `AUTH_TRUSTED_ORIGINS`. Better Auth rejects sign-in POSTs from origins it doesn't trust.

To use another backend, such as staging, without running one locally:

```bash
API_PROXY_TARGET=https://staging.example.com bun run dev
```

When the target isn't localhost, the proxy presents requests as coming from the target's own origin, so the remote backend's origin check passes.

The seeded local test user is `test@gmail.com` / `pass1234`; it is already active, so there's no OTP step. With `SMS_PROVIDER=console`, OTPs for new users are printed in the backend log.

Other scripts:

```bash
bun run typecheck
bun run build        # → build/client (static SPA)
```

> Run `build` with `bun run`, which uses Node. React Router's SPA prerender fails under Bun's own runtime (`bun --bun`). The CLI may warn that the Node version is older than it wants; on Node 22.14 the build still works.

## Production (Docker)

The image builds the SPA and serves it with nginx. nginx also reverse-proxies `/api` (with WebSocket upgrades) and `/health` to `BACKEND_URL`.

```bash
docker build -t zrs-webapp .
docker run -p 8080:80 -e BACKEND_URL=http://backend:4001 zrs-webapp
```

- `BACKEND_URL` is the backend's address **without a path**. Prefer its internal Docker-network address over its public domain: going back out through the public proxy would make every user appear to come from this server's IP.
- Add this site's public origin, e.g. `https://trade.example.com`, to the backend's `AUTH_TRUSTED_ORIGINS`.
- nginx forwards exactly one `X-Forwarded-For` entry: the client IP it resolved, trusting private-network proxies such as Traefik. Set `TRUSTED_PROXY_IP_HEADER=x-forwarded-for` on the backend so its per-IP rate limits see real clients.
