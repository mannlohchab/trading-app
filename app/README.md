# TradingGurukul App (Expo)

Expo SDK 58 client with forex/crypto market data and USD paper trading.

## Run

```bash
# Start API first (see ../server)
cp .env.example .env
bun install
bunx expo start
```

Demo credentials: `demo` / `password123`

See [../README.md](../README.md) for full setup, env vars, and API docs.

## Build an installable Android APK

The `preview` profile in `eas.json` produces a standalone release APK with demo
mode disabled, using `http://192.168.29.2:4000` as its backend. Keep the backend
running on that computer and connect the phone to the same Wi-Fi. Metro and Expo
Go are not needed after installation. The Twelve Data key stays in `server/.env`;
the backend is not bundled into the APK.

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
