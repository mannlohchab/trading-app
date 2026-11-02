# AI Insight formatted responses and market context

Goal: make streamed and saved answers readable, and ground normal chat in the existing crypto/forex feeds. User confirmed existing instruments only. Credentials remain backend-only.

Approach: native text rendering for headings, emphasis, paragraphs, lists, quotes and code; deterministic catalogue matching for current-message names/pairs and explicit referential follow-ups. Use existing Binance/Twelve Data caching and budgets. This avoids a second model call and new dependencies. Do not add equities, arbitrary URLs, trading actions or background quote subscriptions.

## Implementation

- [x] Add a pure response parser and native response component. Test streaming fragments, emphasis, paragraphs, numbered/bullet lists, code, and literal HTML. Integrate into the existing AI screen, preserving errors/history/cancellation.
- [x] Add backend market-context builder. Recognize supported symbols, base symbols and common names with word boundaries; fetch at most three instruments. Resolve explicit Market mode selection. Refresh referential follow-ups from user history only. Fetch daily candles only for analysis/trend requests and retain quotes when history fails. Include quote currencies, timestamps, provider, staleness and missing-data status.
- [x] Integrate context before the model call in normal chat and Market mode. Keep portfolio context. Guide model to concise Markdown with source/time attribution and no invented figures. Test actual route forwarding and saved responses.
- [x] Run backend/client suites, both typechecks and frontend lint. Review the changes. Live network/visual checks depend on environment access.

Review focus: false ticker matches in ordinary words; unrelated questions inheriting old assets; unsupported/ambiguous pairs; mixed quote/history failures; partially streamed Markdown without text loss.

Verification: backend 50/50 and client 75/75 tests passed; both TypeScript checks passed. New component/parser lint passed. Full-app lint reports 25 existing errors and 3 warnings in unrelated code and existing AI-screen hooks. Actual component rendered via React Native Web with heading/emphasis/text checks. Live network verification remains unavailable in this sandbox.

Review fix: unsupported-pair follow-ups previously resurrected older supported pairs. Reproduced with a failing test, then changed reference resolution to clear newer unsupported/unrelated topics. Repeated comparison follow-ups preserve both instruments; all suites pass after the fix.
