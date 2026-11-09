import { and, eq, gte, sql } from 'drizzle-orm';
import { aiUsageEvents } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { UsageEvent, UsageRepository } from '../application/ports';

export class DrizzleUsageRepository implements UsageRepository {
  constructor(private readonly db: AppDatabase) {}

  async record(e: UsageEvent) {
    await this.db.insert(aiUsageEvents).values({
      userId: e.userId,
      conversationId: e.conversationId,
      turnId: e.turnId,
      provider: e.provider,
      model: e.model,
      status: e.status,
      inputTokens: e.usage.inputTokens,
      outputTokens: e.usage.outputTokens,
      costUnits: e.usage.costUnits === undefined ? null : e.usage.costUnits.toFixed(6),
      costUnit: e.usage.costUnit ?? null,
      toolCalls: e.toolCalls,
      latencyMs: e.latencyMs,
      errorCode: e.errorCode ?? null,
    });
  }

  async totals(userId: string, since: Date) {
    const [row] = await this.db
      .select({
        // A turn counts once it produced at least one successful model call.
        turns: sql<number>`count(distinct ${aiUsageEvents.turnId}) filter (where ${aiUsageEvents.status} = 'SUCCEEDED')`.mapWith(Number),
        inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`.mapWith(Number),
        costUnits: sql<number>`coalesce(sum(${aiUsageEvents.costUnits}), 0)`.mapWith(Number),
      })
      .from(aiUsageEvents)
      .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, since)));
    return row ?? { turns: 0, inputTokens: 0, outputTokens: 0, costUnits: 0 };
  }
}
