# Demo preview implementation plan

Goal: Populate every current app screen for UI review without a running API.
Architecture: An explicit EXPO_PUBLIC_DEMO_MODE flag routes API calls to isolated in-memory fixtures. Demo auth never reads or overwrites real credentials. Live mode continues using existing providers; failures never silently enable demo mode.
Tech stack: Existing Expo 58, TypeScript and React Query; no new dependencies.

- [x] Add deterministic sample quotes/OHLC, balanced holdings and transactions, community posts/comments and AI history. Test portfolio arithmetic and usable chart series.
- [x] Add local API adapter with watchlist/community/profile interactions and sample AI streaming; test read/write round trips, cancellation and unsupported operations. Reject simulated order execution/password changes explicitly instead of pretending real changes happened.
- [x] Connect API/auth/socket boundaries to the flag, enable it in local .env, mark preview globally, and explicitly allow demo charts only in this mode. Preserve existing stored sessions.
- [x] Run app tests, TypeScript and web export; attempt required lint. Document the flag and reset behavior.

Review focus: No backend requests in demo; no real-token persistence; no fake live labels; charts across all ranges; portfolio arithmetic; canceled AI streams; unknown routes fail visibly.

Verification: 34 named tests passed, TypeScript passed, web export passed. Lint attempted but blocked by missing ESLint dependencies and restricted package installation. Native visual inspection unavailable because this session cannot bind local server ports.
