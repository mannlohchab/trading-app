import type { Database } from 'bun:sqlite';
import { config } from '../lib/config';

/**
 * v1: remove Indian-market (NSE/BSE/MCX, INR) data and move paper accounts to USD.
 * Old balances, holdings, orders and transactions were INR-denominated and cannot be
 * relabeled as USD, so ledgers are reset to the configured USD starting balance.
 * Pre-existing INTEGER quantity columns keep SQLite numeric affinity and accept fractional values.
 */
export function removeIndianMarketData(db: Database, startingBalance = config.defaultPaperBalance) {
  const supported = "('BINANCE','FOREX')";
  db.transaction(() => {
    db.run(`DELETE FROM watchlist_items WHERE exchange NOT IN ${supported}`);
    db.run(`UPDATE posts SET symbol = NULL, exchange = NULL WHERE exchange IS NOT NULL AND exchange NOT IN ${supported}`);
    db.run('DELETE FROM transactions');
    db.run('DELETE FROM positions');
    db.run('DELETE FROM orders');
    db.run(`UPDATE paper_accounts SET cash_balance = ?, starting_balance = ?, realized_pnl = 0, updated_at = datetime('now')`,
      [startingBalance, startingBalance]);
    db.run('PRAGMA user_version = 1');
  })();
}
