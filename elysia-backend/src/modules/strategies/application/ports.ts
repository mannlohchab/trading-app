import type { StrategyDefinition } from '../domain/definition';

export type StrategySource = 'AI_GENERATED' | 'USER_CREATED';

export type StrategySummary = {
  id: string;
  name: string;
  description: string | null;
  source: StrategySource;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  latestVersion: number;
  createdAt: Date;
  updatedAt: Date;
};
export type StrategyDetail = StrategySummary & { versionId: string; definition: StrategyDefinition; engineVersion: string };

export interface StrategyRepository {
  /** Creates the strategy and its first (immutable) version in one transaction. */
  create(input: { userId: string; name: string; description: string | null; source: StrategySource; definition: StrategyDefinition; engineVersion: string; metadata: Record<string, unknown> }): Promise<StrategyDetail>;
  list(userId: string, options: { limit: number; offset: number }): Promise<{ items: StrategySummary[]; total: number }>;
  find(userId: string, strategyId: string): Promise<StrategyDetail | null>;
}

/** Checks a strategy's market against the instrument catalog. */
export interface InstrumentChecker {
  isActive(exchange: string, symbol: string): Promise<boolean>;
}
