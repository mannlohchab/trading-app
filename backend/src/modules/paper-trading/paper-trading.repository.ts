// Shared read-only lookups: symbol rules from the market catalog, the user's strategy versions.
import { and, desc, eq, ne } from 'drizzle-orm';
import { exchanges, strategies, strategyVersions, tradingSymbols } from '../../db/schema';
import type { AppDatabase } from '../../db/types';
import { dec } from '../backtesting';
import type { SymbolRules } from './paper-trading.types';

export type Db = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
export type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

const optional = (v: unknown) => (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0 ? dec.from(v) : null);

export class PaperTradingRepository {
  constructor(private readonly db: AppDatabase) {}

  async symbolRules(exchange: string, symbol: string, db: Db = this.db): Promise<SymbolRules | null> {
    const [row] = await db.select({ s: tradingSymbols, code: exchanges.code }).from(tradingSymbols)
      .innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(and(eq(exchanges.code, exchange), eq(tradingSymbols.symbol, symbol), eq(tradingSymbols.isActive, true)));
    return row ? toRules(row.s, row.code) : null;
  }

  async symbolRulesById(id: string, db: Db = this.db): Promise<SymbolRules | null> {
    const [row] = await db.select({ s: tradingSymbols, code: exchanges.code }).from(tradingSymbols)
      .innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId)).where(eq(tradingSymbols.id, id));
    return row ? toRules(row.s, row.code) : null;
  }

  /** The user's strategy and exact version (latest when not given). Null if it isn't theirs. */
  async strategyVersion(userId: string, strategyId: string, versionId?: string) {
    const [row] = await this.db.select({ strategy: strategies, version: strategyVersions }).from(strategyVersions)
      .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
      .where(and(eq(strategies.id, strategyId), eq(strategies.userId, userId), ne(strategies.status, 'DELETED'), versionId ? eq(strategyVersions.id, versionId) : undefined))
      .orderBy(desc(strategyVersions.version)).limit(1);
    if (!row) return null;
    return { strategyId: row.strategy.id, name: row.strategy.name, versionId: row.version.id, version: row.version.version, definition: { ...row.version.definition, risk: row.version.riskSettings } };
  }
}

function toRules(s: typeof tradingSymbols.$inferSelect, exchange: string): SymbolRules | null {
  if (!s.priceTickSize || !s.quantityStepSize) return null;
  const meta = s.metadata as { minQuantity?: unknown; minNotional?: unknown };
  return {
    id: s.id, exchange, symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset,
    tickSize: dec.from(s.priceTickSize), lotSize: dec.from(s.quantityStepSize),
    minQuantity: optional(meta.minQuantity), minNotional: optional(meta.minNotional),
  };
}
