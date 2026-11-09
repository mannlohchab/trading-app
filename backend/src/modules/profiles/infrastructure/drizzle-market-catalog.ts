import { and, eq } from 'drizzle-orm';
import { exchanges, tradingSymbols } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { MarketCatalog } from '../application/ports';

export class DrizzleMarketCatalog implements MarketCatalog {
  constructor(private readonly db: AppDatabase) {}

  async findExchange(code: string) {
    const [row] = await this.db
      .select({ id: exchanges.id, code: exchanges.code, isActive: exchanges.isActive })
      .from(exchanges)
      .where(eq(exchanges.code, code));
    return row ?? null;
  }

  async findSymbol(exchangeId: string, symbol: string) {
    const [row] = await this.db
      .select({ id: tradingSymbols.id, symbol: tradingSymbols.symbol, exchangeId: tradingSymbols.exchangeId, assetType: tradingSymbols.assetType, isActive: tradingSymbols.isActive })
      .from(tradingSymbols)
      .where(and(eq(tradingSymbols.exchangeId, exchangeId), eq(tradingSymbols.symbol, symbol)));
    return row ?? null;
  }
}
