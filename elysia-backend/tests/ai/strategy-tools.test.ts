import { describe, expect, test } from 'bun:test';
import { createTools, ToolInputError, type BacktestGateway, type MarketGateway, type StrategyDraftChecker, type ToolOutcome } from '../../src/modules/ai/application/tools';
import { validateStrategyDraft } from '../../src/modules/strategies/domain/definition';

const market: MarketGateway = {
  exchange: 'BINANCE',
  async searchSymbols() { return []; },
  async tickers() { return []; },
  async topMovers() { return []; },
  async analyze() { return { summary: null, source: 'store' }; },
  async candles() { return { candles: [], source: 'store' }; },
};

const checker: StrategyDraftChecker = {
  async validate(input) {
    const result = validateStrategyDraft(input);
    return result.ok ? { ...result, summary: [] } : result;
  },
};

function fixture() {
  const previews: Parameters<BacktestGateway['preview']>[1][] = [];
  const gateway: BacktestGateway = {
    async preview(_userId, request) {
      previews.push(request);
      return {
        market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' },
        range: { start: 1_000, end: 2_000 }, metrics: {}, warnings: [], trades: [], equityCurve: [],
        engine: { name: 'fixture', version: '1' }, dataset: { candles: 500 },
      };
    },
  };
  const tools = createTools(market, checker, undefined, { gateway, userId: 'researcher' });
  return { previews, draft: tools.find(tool => tool.spec.name === 'draft_strategy')!, backtest: tools.find(tool => tool.spec.name === 'run_backtest')! };
}

const plainDraft = () => ({
  name: 'RSI research',
  description: null,
  definition: {
    market: { exchange: 'binance', symbol: 'btcusdt', timeframe: '1h' },
    direction: 'LONG',
    entry: { conditions: [{ left: { type: 'RSI', period: 14, value: null, fast: 12 }, operator: 'GT', right: 70 }] },
    exit: { conditions: [], stopLossPercent: 5, takeProfitPercent: null },
    risk: { positionSizePercent: 20 },
  },
});

const advancedDraft = (direction: 'LONG' | 'SHORT' = 'SHORT') => {
  const draft = plainDraft();
  return { ...draft, definition: { ...draft.definition, direction,
    entry: { ...draft.definition.entry, pyramiding: 3 },
    exit: { ...draft.definition.exit, trailingStop: { activationPercent: 0, offsetPercent: 2 },
      partialTakeProfits: [{ profitPercent: 4, quantityPercent: 25 }, { profitPercent: 8, quantityPercent: 50 }] },
  } };
};

function draftBlock(outcome: ToolOutcome) {
  const block = outcome.blocks?.find(block => block.type === 'strategy_draft');
  if (!block || block.type !== 'strategy_draft') throw new Error('Missing strategy draft card');
  return block;
}

describe('AI strategy normalization', () => {
  test('a SHORT draft keeps advanced rules in its saveable card and draftId backtest', async () => {
    const { draft, backtest, previews } = fixture();
    const requested = advancedDraft();
    const card = draftBlock(await draft.run(requested));
    const checked = validateStrategyDraft(card.draft);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error('Normalized draft failed strict validation');
    expect(checked.draft.definition).toEqual({
      ...requested.definition,
      market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' },
      entry: { pyramiding: 3, conditions: [{ left: { type: 'RSI', period: 14 }, operator: 'GT', right: { type: 'VALUE', value: 70 } }] },
      exit: { conditions: [], stopLossPercent: 5, trailingStop: { activationPercent: 0, offsetPercent: 2 }, partialTakeProfits: requested.definition.exit.partialTakeProfits },
    });
    expect(checked.draft).not.toHaveProperty('description');
    await backtest.run({ draftId: card.draftId });
    expect(previews).toHaveLength(1);
    expect(previews[0]!.definition).toEqual(checked.draft.definition);
  });

  test('direct run_backtest definitions use the same advanced-rule normalization', async () => {
    const { backtest, previews } = fixture();
    const requested = advancedDraft('LONG');
    await backtest.run({ name: requested.name, definition: requested.definition, candles: 400 });
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ name: requested.name, candles: 400, definition: {
      direction: 'LONG', entry: { pyramiding: 3 },
      exit: { trailingStop: { activationPercent: 0, offsetPercent: 2 }, partialTakeProfits: requested.definition.exit.partialTakeProfits },
    } });
    const checked = validateStrategyDraft({ name: requested.name, definition: previews[0]!.definition });
    expect(checked.ok).toBe(true);
  });

  test('omitted or null advanced fields preserve the existing single-entry fixed-stop default', async () => {
    for (const includeNulls of [false, true]) {
      const { draft } = fixture();
      const requested = plainDraft();
      const input = includeNulls ? { ...requested, definition: { ...requested.definition,
        entry: { ...requested.definition.entry, pyramiding: null },
        exit: { ...requested.definition.exit, trailingStop: null, partialTakeProfits: null },
      } } : requested;
      const card = draftBlock(await draft.run(input));
      const checked = validateStrategyDraft(card.draft);
      expect(checked.ok).toBe(true);
      if (!checked.ok) throw new Error('Default draft failed strict validation');
      expect(checked.draft.definition.direction).toBe('LONG');
      expect(checked.draft.definition.entry).not.toHaveProperty('pyramiding');
      expect(checked.draft.definition.exit).toEqual({ conditions: [], stopLossPercent: 5 });
    }
  });

  test('invalid partial quantities and SHORT targets reach strict validation without being dropped', async () => {
    const { draft, backtest, previews } = fixture();
    const requested = advancedDraft();
    const invalidQuantities = { ...requested, definition: { ...requested.definition, exit: { ...requested.definition.exit,
      partialTakeProfits: [{ profitPercent: 4, quantityPercent: 60 }, { profitPercent: 8, quantityPercent: 60 }],
    } } };
    await expect(draft.run(invalidQuantities)).rejects.toThrow('Partial take-profit quantities must total at most 100%');
    await expect(backtest.run({ definition: invalidQuantities.definition })).rejects.toThrow(ToolInputError);
    await expect(backtest.run({ definition: { ...requested.definition, exit: { ...requested.definition.exit, takeProfitPercent: 100 } } })).rejects.toThrow('below 100%');
    expect(previews).toHaveLength(0);
  });

  test('invalid pyramiding and zero trailing distance are rejected rather than silently simplified', async () => {
    const { draft } = fixture();
    const requested = advancedDraft();
    await expect(draft.run({ ...requested, definition: { ...requested.definition, entry: { ...requested.definition.entry, pyramiding: 1.5 } } })).rejects.toThrow(ToolInputError);
    await expect(draft.run({ ...requested, definition: { ...requested.definition, exit: { ...requested.definition.exit, trailingStop: { activationPercent: 0, offsetPercent: 0 } } } })).rejects.toThrow(ToolInputError);
  });
});
