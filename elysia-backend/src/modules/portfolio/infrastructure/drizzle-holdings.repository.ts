import { asc, eq, max } from 'drizzle-orm';
import { portfolioHoldings, users } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { HoldingsRepository } from '../application/ports';
import { trimDecimal } from '../domain/holdings';

const H = portfolioHoldings;

export class DrizzleHoldingsRepository implements HoldingsRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(userId: string) {
    const rows = await this.db.select().from(H).where(eq(H.userId, userId)).orderBy(asc(H.position));
    const [latest] = await this.db.select({ at: max(H.updatedAt) }).from(H).where(eq(H.userId, userId));
    return {
      holdings: rows.map(r => ({ asset: r.asset, quantity: trimDecimal(r.quantity), boughtOn: r.boughtOn, buyPrice: r.buyPrice === null ? null : trimDecimal(r.buyPrice) })),
      updatedAt: latest?.at ?? null,
    };
  }

  async replace(userId: string, holdings: { asset: string; quantity: string; boughtOn: string; buyPrice: string | null }[]) {
    await this.db.transaction(async tx => {
      // Serialises saves by the same user, so two at once can't collide on row positions.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.delete(H).where(eq(H.userId, userId));
      if (holdings.length) await tx.insert(H).values(holdings.map((h, position) => ({ userId, position, ...h })));
    });
  }
}
