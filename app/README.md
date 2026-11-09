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

Not connected yet, because the backend has no module for them: community, watchlists, economic
calendar/indicators/news and forex. The Community tab is hidden and Home shows live discovery lists
instead of a watchlist.

`EXPO_PUBLIC_DEMO_MODE=true` still previews the screens with local sample data and no network.

See [../README.md](../README.md) for full setup and [../backend/README.md](../backend/README.md) for the API.

## Build an installable Android APK

The `preview` profile in `eas.json` produces a standalone release APK with demo
mode disabled, using `http://192.168.29.2:4001` as its backend. Keep the backend
running on that computer and connect the phone to the same Wi-Fi. Metro and Expo
Go are not needed after installation. The backend is not bundled into the APK.

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

To use the APK outside this Wi-Fi, set `build.preview.env.EXPO_PUBLIC_API_URL` in
`eas.json` to your deployed HTTPS API URL, remove `ANDROID_ALLOW_HTTP_BACKEND`,
and rebuild. The HTTP opt-in enables Android cleartext traffic for this internal
build only. Changing local `.env` does not change an already installed APK.

See [Expo's APK build guide](https://docs.expo.dev/build-reference/apk/).
