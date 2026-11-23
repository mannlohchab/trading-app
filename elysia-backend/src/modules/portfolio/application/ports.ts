// Ports for the portfolio module: storage behind `HoldingsRepository`, prices behind `PriceSource`
// (implemented with the market module).
import type { Holding } from '../domain/holdings';

export interface HoldingsRepository {
  /** In the user's row order. */
  list(userId: string): Promise<{ holdings: Holding[]; updatedAt: Date | null }>;
  /** Replaces the user's whole table atomically. */
  replace(userId: string, holdings: Holding[]): Promise<void>;
}

export interface PriceSource {
  readonly currency: string;
  /** Which of these pairs are listed and active. */
  listed(symbols: string[]): Promise<Set<string>>;
  /** Latest price per pair; pairs without a price are left out. */
  lastPrices(symbols: string[]): Promise<Map<string, number>>;
  /** Daily close of a pair on a UTC date (YYYY-MM-DD), or null if unknown. */
  dailyClose(symbol: string, day: string): Promise<number | null>;
}

export interface Clock { now(): Date }
