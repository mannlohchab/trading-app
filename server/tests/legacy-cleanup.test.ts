import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { removeIndianMarketData } from '../src/db/legacyCleanup';

test('legacy cleanup removes Indian-market rows and resets INR ledgers to USD once', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE watchlist_items (id TEXT, symbol TEXT, exchange TEXT);
    CREATE TABLE posts (id TEXT, symbol TEXT, exchange TEXT);
    CREATE TABLE orders (id TEXT, exchange TEXT);
    CREATE TABLE positions (id TEXT, exchange TEXT);
    CREATE TABLE transactions (id TEXT, exchange TEXT);
    CREATE TABLE paper_accounts (id TEXT, cash_balance REAL, starting_balance REAL, realized_pnl REAL, updated_at TEXT);
    INSERT INTO watchlist_items VALUES ('a','RELIANCE','NSE'),('b','SENSEX','BSE'),('c','BTCUSDT','BINANCE'),('d','EUR/USD','FOREX');
    INSERT INTO posts VALUES ('p1','TCS','NSE'),('p2','ETHUSDT','BINANCE'),('p3',NULL,NULL);
    INSERT INTO orders VALUES ('o','NSE'); INSERT INTO positions VALUES ('x','NSE'); INSERT INTO transactions VALUES ('t','NSE');
    INSERT INTO paper_accounts VALUES ('acc', 812345.5, 1000000, 4200, '');
  `);
  removeIndianMarketData(db, 100000);
  expect(db.query('SELECT symbol FROM watchlist_items ORDER BY id').values()).toEqual([['BTCUSDT'], ['EUR/USD']]);
  expect(db.query('SELECT id, symbol, exchange FROM posts ORDER BY id').values())
    .toEqual([['p1', null, null], ['p2', 'ETHUSDT', 'BINANCE'], ['p3', null, null]]);
  for (const t of ['orders', 'positions', 'transactions']) expect(db.query(`SELECT count(*) FROM ${t}`).values()).toEqual([[0]]);
  expect(db.query('SELECT cash_balance, starting_balance, realized_pnl FROM paper_accounts').values()).toEqual([[100000, 100000, 0]]);
  expect(db.query('PRAGMA user_version').values()).toEqual([[1]]);
});
