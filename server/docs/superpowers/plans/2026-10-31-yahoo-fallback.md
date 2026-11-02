# Yahoo fallback implementation plan

**Goal:** Keep Angel One primary and use real Yahoo data when Angel is absent or fails.

**Architecture:** Add a dependency-free Yahoo chart adapter behind the existing provider interface. Angel delegates failed quote/history calls to it. No generated prices enter this fallback chain. Quote and history responses identify Yahoo as the source.

**Constraints:** Preserve API shapes; cache/coalesce requests; bound network waits; reject unsupported exchanges rather than substituting foreign commodity contracts. Existing paper trading consumes the same quote provider.

## Tasks

- [x] Add provider tests for Angel priority, Yahoo fallback, symbol mapping, malformed/missing data, caching, unsupported exchanges, and real history without Angel credentials.
- [x] Implement Yahoo quote/history conversion, provider selection, and Angel fallback. Derive overview/movers from actual quotes rather than generated prices.
- [x] Expose source metadata and show Yahoo fallback on quote cards and instrument details; update API/environment documentation.
- [x] Run server tests/typecheck, app tests/typecheck/lint, and review failure paths. Attempt a live Yahoo request and report any network limitation.

## Review focus

Wrong exchange/currency, missing candles, duplicate upstream requests, both feeds unavailable, and falsely labeling fallback prices as Angel/live.

## Verification

15 backend tests passed; backend and app typechecks passed; all three app test files passed; Expo web export passed. Independent review found two issues, both reproduced with failing tests and fixed: Yahoo fallback no longer blocks the Angel history queue, and portfolio valuation rejects missing quotes rather than using entry prices. A second review found no important preview issues.

Live Yahoo verification was blocked by DNS (`getaddrinfo ETIMEOUT query1.finance.yahoo.com`). ESLint is not installed; Expo lint's attempted installation is blocked by environment restrictions. Native visual/touch testing was not available.

The user's additional chart request was implemented as a light stock preview route with real historical prices, purple area chart, range tabs, quote stats and a bottom Open chart action that opens the existing full chart.
