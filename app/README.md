# TradingGurukul App (Expo)

Expo SDK 58 client for the Hono backend in [`../backend`](../backend/README.md): live Binance crypto
prices, paper trading with virtual USDT, and the AI assistant.

## Run

```bash
# Start the backend first (see ../backend/README.md); it listens on :4001
cp .env.example .env      # EXPO_PUBLIC_API_URL; a phone needs your computer's LAN IP, not localhost
bun install
bunx expo start
```

**Sign-in.** Register with email and password, then verify a phone number by SMS code; the backend
activates the account only after that step (`app/(auth)/verify-phone.tsx`). Sessions are Better Auth
cookies: kept in SecureStore on iOS/Android (`@better-auth/expo`) and by the browser on web.
In development the backend's console SMS adapter prints the code in the backend log.

**What talks to what** (`src/lib/`):

| Module | Backend |
|---|---|
| `authClient.ts`, `store/auth.ts` | `/api/v1/auth/*` (email sign-in/up, phone OTP, session), `/api/v1/me/profile` |
| `marketData.ts` | `/api/v1/market/tickers`, `/candles`, `/symbols` (Binance spot, USDT pairs) |
| `socket.ts` | WebSocket `/api/v1/market/stream` (live tickers and candles) |
| `paperTrading.ts` | `/api/v1/paper/*`; the app creates one account (100,000 USDT) on first use |
| `aiApi.ts`, `api.ts` (`streamAiMessage`) | `/api/v1/ai/conversations` and the SSE message stream |
| `calendarApi.ts`, `financialCalendar.ts` | `/api/v1/calendar` (weekly economic events, cached by the backend) |

Not connected yet, because the backend has no module for them: community, watchlists, economic
indicators/news and forex. The Community tab is hidden and Home shows live discovery lists
instead of a watchlist.

`EXPO_PUBLIC_DEMO_MODE=true` still previews the screens with local sample data and no network.

The Calendar tab uses the app's normal login and API URL. It shows the published Forex Factory week
with a compact date strip, an expandable month grid and a bold color-coded event timeline. The purple
filter button opens currency/event search and impact filters; Full week shows the published schedule.
Use the selected date to return to a single-day agenda, or pull to refresh. Event times use the profile
timezone (device timezone when unset). Holidays are all-day entries in the affected market's date;
date-only announcements retain their supplied date. Unknown actual/forecast/previous values display
as `—`. Source, retrieval time and stale-cache notices are visible. Demo events are explicitly labeled
and only served in demo mode. Historical weeks and crypto-specific dates are not part of this feed.

See [../README.md](../README.md) for full setup and [../backend/README.md](../backend/README.md) for the API.

## Build an installable Android APK

The `preview` profile in `eas.json` produces a standalone release APK with demo
mode disabled, using the hosted staging backend `https://194-163-189-72.sslip.io`.
It works on any network. Metro and Expo Go are not needed after installation.
The backend is not bundled into the APK.

From this directory:

```bash
bunx eas-cli login
EAS_NO_VCS=1 bunx eas-cli build --platform android --profile preview
```

The first build may ask to create/link an Expo project and generate an Android
signing keystore. EAS prints the build page and APK download link when the build
finishes. Open that link on the phone to install the APK.

`EAS_NO_VCS=1` permits building the current working files without creating a Git
commit. Local `.env` files are excluded from uploads; the profile provides the
public build configuration explicitly.

To build against a backend on your own computer instead, set
`build.preview.env.EXPO_PUBLIC_API_URL` in `eas.json` to its LAN address (e.g.
`http://192.168.1.20:4001`), add `"ANDROID_ALLOW_HTTP_BACKEND": "true"` (Android
blocks plain HTTP otherwise), and rebuild; the phone must be on the same Wi-Fi.
Changing local `.env` does not change an already installed APK.

See [Expo's APK build guide](https://docs.expo.dev/build-reference/apk/).

## Over-the-air updates (EAS Update)

Preview APKs check the `preview` channel for JavaScript updates on launch, and again
when the app returns to the foreground (at most every 15 minutes). A downloaded update
applies on the next cold start, or immediately when the user taps **Restart** on the
"A new version is ready" banner.

Publish the current JavaScript and assets to everyone on the preview build:

```bash
bun run update:preview                       # message = latest commit subject
bun run update:preview -- "Fix chart drawing" # or your own message
```

`scripts/eas-update.mjs` takes the channel, EAS environment and `EXPO_PUBLIC_*`
values from the `preview` build profile in `eas.json`, so an update always talks to the
same backend as the APK. Calling `eas update` directly would bundle the local `.env`
instead.

- **Only JavaScript, styles and assets** ship this way. A new native dependency,
  permission, or `app.json` native setting needs a new `eas build`.
- **Runtime version:** `runtimeVersion` uses the `fingerprint` policy, so an update
  only reaches builds whose native code matches. If an update isn't arriving after a
  native change, the installed APK is too old: rebuild it.
- **APKs built before OTA was added** (without `expo-updates`) never receive updates.
  Build once more with the command above, then use `update:preview` from then on.
- Updates do nothing in Expo Go, development builds and on web.

See [Expo's EAS Update guide](https://docs.expo.dev/eas-update/getting-started/).
