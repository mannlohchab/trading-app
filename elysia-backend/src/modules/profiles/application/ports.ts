import type { Preferences, ExchangeRef, SymbolRef } from '../domain/preferences';
import type { Profile } from '../domain/profile';

export interface ProfileStore {
  find(userId: string): Promise<Profile | null>;
  /** Applies all changes atomically. Fails with USERNAME_TAKEN if the username is in use (case-insensitive). */
  update(userId: string, changes: { name?: string; username?: string | null; image?: string | null; timezone?: string }): Promise<'OK' | 'USERNAME_TAKEN'>;
}

export interface PreferencesStore {
  /** Saved preferences, or null when the user has never saved any. */
  find(userId: string): Promise<Preferences | null>;
  /**
   * Runs `change` against the current preferences while holding a row lock and saves what it returns.
   * `catalog` reads within the same transaction. `change` returns either the new preferences with the
   * resolved reference ids, or a rejection.
   */
  update<R>(
    userId: string,
    change: (current: Preferences, catalog: MarketCatalog) => Promise<{ save: Preferences; refs: { exchangeId: string | null; symbolId: string | null }; result: R } | { reject: R }>,
  ): Promise<R>;
}

export interface MarketCatalog {
  findExchange(code: string): Promise<ExchangeRef | null>;
  findSymbol(exchangeId: string, symbol: string): Promise<SymbolRef | null>;
}
