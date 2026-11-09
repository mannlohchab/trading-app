import { ENGINE_VERSION, validateStrategyDraft } from '../domain/definition';
import type { InstrumentChecker, StrategyDetail, StrategyRepository, StrategySource } from './ports';

export type CreateResult = { ok: true; strategy: StrategyDetail } | { ok: false; errors: Record<string, string> };

export class StrategyService {
  constructor(private readonly deps: { strategies: StrategyRepository; instruments: InstrumentChecker }) {}

  /** Validates a draft (structure + market exists) without saving it. */
  async validate(input: unknown) {
    const result = validateStrategyDraft(input);
    if (!result.ok) return result;
    const { exchange, symbol } = result.draft.definition.market;
    if (!(await this.deps.instruments.isActive(exchange, symbol))) {
      return { ok: false as const, errors: { 'definition.market.symbol': `${symbol} is not an active market on ${exchange}.` } };
    }
    return result;
  }

  async create(userId: string, input: unknown, source: StrategySource, metadata: Record<string, unknown> = {}): Promise<CreateResult> {
    const result = await this.validate(input);
    if (!result.ok) return result;
    const { name, description, definition } = result.draft;
    const strategy = await this.deps.strategies.create({ userId, name, description: description ?? null, source, definition, engineVersion: ENGINE_VERSION, metadata });
    return { ok: true, strategy };
  }

  list(userId: string, limit = 50, offset = 0) {
    return this.deps.strategies.list(userId, { limit: Math.min(100, Math.max(1, limit)), offset: Math.max(0, offset) });
  }

  get(userId: string, strategyId: string) {
    return this.deps.strategies.find(userId, strategyId);
  }
}
