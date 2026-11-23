// A deliberately synthetic, self-contained quote replay. No exchange data or actual fee rates.
// bun src/scripts/backtest-fixture.ts > /tmp/backtest-dataset.json
const start = Date.parse('2026-11-20T03:45:00Z');
const end = start + 60_000;
console.log(JSON.stringify({
  schemaVersion: 1,
  name: 'Synthetic equity quote replay — not market history',
  provenance: { source: 'Generated software test fixture', license: 'Synthetic fixture, freely reusable', importedAt: end, adjustment: 'raw' },
  instruments: [{ id: 'fixture-equity', exchange: 'NSE', symbol: 'TEST-EQUITY', assetClass: 'equity', currency: 'INR', tickSize: '0.05', lotSize: '1', pointValue: '1', listedAt: start }],
  calendars: { 'fixture-equity': { timezone: 'Asia/Kolkata', source: 'Synthetic one-minute test session', version: 'fixture-1', coverageStart: start, coverageEnd: end, sessions: [{ openTime: start, closeTime: end }] } },
  quotes: [
    { instrumentId: 'fixture-equity', eventId: 'q1', time: start, receivedAt: start, bid: '99.95', ask: '100', bidSize: '100', askSize: '100' },
    { instrumentId: 'fixture-equity', eventId: 'q2', time: start + 2000, receivedAt: start + 2000, bid: '101', ask: '101.05', bidSize: '100', askSize: '100' },
  ],
  feeSchedules: [{ id: 'synthetic-fees', source: 'Zero-cost test fixture, not an Indian brokerage tariff', exchange: 'NSE', assetClass: 'equity', validFrom: start, validTo: end, components: [] }],
}, null, 2));
