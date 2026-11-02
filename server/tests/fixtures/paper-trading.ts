import assert from 'node:assert/strict';

assert.equal(process.env.DATABASE_URL, ':memory:');
const { sqlite } = await import('../../src/db');
await import('../../src/db/migrate');
const { getMarketDataProvider } = await import('../../src/providers/marketData');
const { placeOrder, portfolioSummary } = await import('../../src/modules/trading/engine');

sqlite.run("INSERT INTO users(id,email,username,password_hash) VALUES('u','u@example.invalid','u','unused')");
sqlite.run("INSERT INTO paper_accounts(id,user_id,cash_balance,starting_balance) VALUES('acc','u',100000,100000)");
let price = 60000;
const provider = getMarketDataProvider();
provider.quote = async (symbol: string, exchange?: string) => ({ symbol, exchange: exchange ?? 'BINANCE', name: symbol, ltp: price,
  open: price, high: price, low: price, close: price, change: 0, changePercent: 0, volume: 1, currency: 'USDT' });

await placeOrder({ userId: 'u', symbol: 'btc/usdt', side: 'BUY', orderType: 'MARKET', quantity: 0.1 });
await placeOrder({ userId: 'u', symbol: 'BTCUSDT', exchange: 'BINANCE', side: 'BUY', orderType: 'MARKET', quantity: 0.2 });
let summary = await portfolioSummary('u');
assert.equal(summary.positions.length, 1);
assert.equal(summary.positions[0].quantity, 0.3);
assert.equal(summary.positions[0].exchange, 'BINANCE');
assert.equal(summary.cashBalance, 100000 - 18000);

price = 70000;
await placeOrder({ userId: 'u', symbol: 'BTCUSDT', exchange: 'BINANCE', side: 'SELL', orderType: 'MARKET', quantity: 0.3 });
summary = await portfolioSummary('u');
assert.equal(summary.positions.length, 0);
assert.equal(Math.round(summary.realizedPnl), 3000);
assert.equal(Math.round(summary.cashBalance), 103000);
await assert.rejects(placeOrder({ userId: 'u', symbol: 'BTCUSDT', exchange: 'BINANCE', side: 'SELL', orderType: 'MARKET', quantity: 0.01 }),
  /Insufficient position/);
