import { and, count, desc, eq, ne } from 'drizzle-orm';
import { strategies, strategyVersions } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { StrategyDetail, StrategyRepository, StrategySummary } from '../application/ports';
import type { StrategyDefinition } from '../domain/definition';

/** The definition is split across columns: market/rules in `definition`, risk in `risk_settings`. */
const toColumns = ({ risk, ...rest }: StrategyDefinition) => ({ definition: rest, riskSettings: risk });
const fromColumns = (definition: Record<string, unknown>, riskSettings: Record<string, unknown>) =>
  ({ ...definition, risk: riskSettings }) as unknown as StrategyDefinition;

export class DrizzleStrategyRepository implements StrategyRepository {
  constructor(private readonly db: AppDatabase) {}

  create: StrategyRepository['create'] = input =>
    this.db.transaction(async tx => {
      const [strategy] = await tx
        .insert(strategies)
        .values({ userId: input.userId, name: input.name, description: input.description, source: input.source })
        .returning();
      const [version] = await tx
        .insert(strategyVersions)
        .values({ strategyId: strategy!.id, version: 1, ...toColumns(input.definition), parameters: input.metadata, engineVersion: input.engineVersion })
        .returning();
      return {
        id: strategy!.id, name: strategy!.name, description: strategy!.description, source: strategy!.source, status: strategy!.status,
        latestVersion: 1, createdAt: strategy!.createdAt, updatedAt: strategy!.updatedAt,
        versionId: version!.id, definition: input.definition, engineVersion: version!.engineVersion,
      };
    });

  async list(userId: string, { limit, offset }: { limit: number; offset: number }) {
    const where = and(eq(strategies.userId, userId), ne(strategies.status, 'DELETED'));
    const [rows, [total]] = await Promise.all([
      this.db.query.strategies.findMany({
        where, orderBy: desc(strategies.updatedAt), limit, offset,
        with: { versions: { columns: { version: true }, orderBy: desc(strategyVersions.version), limit: 1 } },
      }),
      this.db.select({ n: count() }).from(strategies).where(where),
    ]);
    const items: StrategySummary[] = rows.map(r => ({
      id: r.id, name: r.name, description: r.description, source: r.source, status: r.status,
      latestVersion: r.versions[0]?.version ?? 0, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
    return { items, total: total?.n ?? 0 };
  }

  async find(userId: string, strategyId: string): Promise<StrategyDetail | null> {
    const row = await this.db.query.strategies.findFirst({
      where: and(eq(strategies.id, strategyId), eq(strategies.userId, userId), ne(strategies.status, 'DELETED')),
      with: { versions: { orderBy: desc(strategyVersions.version), limit: 1 } },
    });
    const v = row?.versions[0];
    if (!row || !v) return null;
    return {
      id: row.id, name: row.name, description: row.description, source: row.source, status: row.status,
      latestVersion: v.version, createdAt: row.createdAt, updatedAt: row.updatedAt,
      versionId: v.id, definition: fromColumns(v.definition, v.riskSettings), engineVersion: v.engineVersion,
    };
  }
}
