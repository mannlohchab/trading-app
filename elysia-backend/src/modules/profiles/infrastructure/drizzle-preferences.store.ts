import { eq } from 'drizzle-orm';
import { exchanges, tradingSymbols, userPreferences } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { PreferencesStore } from '../application/ports';
import { DrizzleMarketCatalog } from './drizzle-market-catalog';
import { toPreferences, toRow } from './preferences-mapper';

export class DrizzlePreferencesStore implements PreferencesStore {
  constructor(private readonly db: AppDatabase) {}

  private select(db: Pick<AppDatabase, 'select'>, userId: string) {
    return db
      .select({ row: userPreferences, exchangeCode: exchanges.code, symbol: tradingSymbols.symbol })
      .from(userPreferences)
      .leftJoin(exchanges, eq(exchanges.id, userPreferences.defaultExchangeId))
      .leftJoin(tradingSymbols, eq(tradingSymbols.id, userPreferences.defaultTradingSymbolId))
      .where(eq(userPreferences.userId, userId));
  }

  async find(userId: string) {
    const [found] = await this.select(this.db, userId);
    return found ? toPreferences(found.row, found.exchangeCode, found.symbol) : null;
  }

  update: PreferencesStore['update'] = (userId, change) =>
    this.db.transaction(async tx => {
      // Make sure a row exists so it can be locked; defaults come from the column definitions.
      await tx.insert(userPreferences).values({ userId }).onConflictDoNothing({ target: userPreferences.userId });
      const [locked] = await this.select(tx, userId).for('update', { of: userPreferences });
      const outcome = await change(toPreferences(locked!.row, locked!.exchangeCode, locked!.symbol), new DrizzleMarketCatalog(tx as AppDatabase));
      if ('reject' in outcome) return outcome.reject;
      await tx.update(userPreferences).set(toRow(outcome.save, outcome.refs)).where(eq(userPreferences.userId, userId));
      return outcome.result;
    });
}
