import { z } from 'zod';
import type { PaperTradingServices } from '../../paper-trading/paper-trading.service';
import { ACCOUNT_LIMITS, EXECUTION, PAPER_CURRENCY, PAPER_EXCHANGE } from '../../paper-trading/paper-trading.constants';
import { PaperError } from '../../paper-trading/paper-trading.errors';
import { createAccountSchema, startStrategySchema, liveScheduleFields } from '../../paper-trading/paper-trading.schemas';
import type { StrategyService } from '../../strategies';
import { strategyDefinitionSchema, strategyDraftSchema, type StrategyDefinition } from '../../strategies/domain/definition';

const page = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(100_000).default(0),
};
export const livePageSchema = z.strictObject(page);
export const liveAccountSchema = createAccountSchema.extend({
  initialBalance: createAccountSchema.shape.initialBalance.unwrap().refine(v => Number(v) >= Number(ACCOUNT_LIMITS.minInitialBalance) && Number(v) <= Number(ACCOUNT_LIMITS.maxInitialBalance), `Virtual capital must be ${ACCOUNT_LIMITS.minInitialBalance}–${ACCOUNT_LIMITS.maxInitialBalance} ${PAPER_CURRENCY}.`),
});
export const liveStartSchema = z.strictObject({
  ...liveScheduleFields,
  strategyId: z.uuid().optional(),
  strategyVersionId: z.uuid().optional(),
  draft: strategyDraftSchema.optional(),
  accountId: z.uuid().optional(),
  newAccount: liveAccountSchema.optional(),
  symbol: startStrategySchema.shape.symbol,
  timeframe: startStrategySchema.shape.timeframe,
  positionSizing: startStrategySchema.shape.positionSizing,
  execution: startStrategySchema.shape.execution,
}).superRefine((v, ctx) => {
  if (Boolean(v.strategyId) === Boolean(v.draft)) ctx.addIssue({ code: 'custom', message: 'Provide exactly one saved strategyId or strategy draft.' });
  if (v.strategyVersionId && !v.strategyId) ctx.addIssue({ code: 'custom', path: ['strategyVersionId'], message: 'A version requires its saved strategyId.' });
  if (Boolean(v.accountId) === Boolean(v.newAccount)) ctx.addIssue({ code: 'custom', message: 'Select an existing accountId or provide a new virtual account with name and capital.' });
  if (v.endTime !== undefined && v.durationMinutes !== undefined) ctx.addIssue({ code: 'custom', message: 'Choose endTime or durationMinutes, not both.' });
  if (v.closePositionAtEnd && v.endTime === undefined && v.durationMinutes === undefined) ctx.addIssue({ code: 'custom', message: 'closePositionAtEnd requires a deadline.' });
});
export const liveListSchema = z.strictObject({ ...page, status: z.enum(['CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED']).optional() });
export const liveControlSchema = z.strictObject({
  instanceId: z.uuid(), action: z.enum(['pause', 'resume', 'stop']), closePosition: z.boolean().optional(),
}).refine(v => v.closePosition === undefined || v.action === 'stop', 'closePosition is available only when stopping.');
export const liveAccountReportSchema = z.strictObject({
  accountId: z.uuid(), section: z.enum(['summary', 'orders', 'positions', 'trades', 'transactions']).default('summary'), ...page,
});

const assumptions = {
  funds: 'Virtual funds only. No exchange trading API or real orders are used.',
  signals: 'Signals run on newly closed candles at the selected interval. The first evaluation establishes the live starting point; past or paused candles are never traded retrospectively.',
  fills: 'Simulated fills use live bid/ask when available and fall back to last trade price when bid/ask is unavailable, plus configured costs. They do not reconstruct queue position or market impact.',
  freshness: `Execution requires quotes no older than ${EXECUTION.maxQuoteAgeMs} ms. Unpriced open positions have null mark/P&L; account summaries value them at cost and list unpricedSymbols.`,
  limits: 'Automated live paper strategies currently support one LONG position, fixed protective exits and indicator exits. SHORT, pyramiding, trailing stops and partial profit targets remain historical-only.',
  deadline: 'A requested deadline stops new strategy signals and orders. The engine sweep updates stopped status within its normal 15-second cadence while running. Positions stay open unless closePositionAtEnd was requested; failed closing attempts are explicitly recorded and existing protection continues.',
};
const labelled = <T extends object>(value: T) => ({ ...value, executionMode: 'PAPER_LIVE' as const, simulated: true as const, assumptions });

function supported(definition: StrategyDefinition) {
  if (definition.direction !== 'LONG' || (definition.entry.pyramiding ?? 1) > 1 || definition.exit.trailingStop || definition.exit.partialTakeProfits?.length) {
    throw new PaperError('INVALID_STRATEGY', assumptions.limits);
  }
  if (definition.market.exchange.toUpperCase() !== PAPER_EXCHANGE) throw new PaperError('UNKNOWN_SYMBOL', `Live paper testing currently uses ${PAPER_EXCHANGE} ${PAPER_CURRENCY} pairs.`);
}

/** The chat can operate only the user's existing virtual-account services. */
export function createLiveTestingGateway({ paper, strategies }: { paper: PaperTradingServices; strategies: StrategyService }) {
  return {
    async listAccounts(userId: string, raw: z.input<typeof livePageSchema> = {}) {
      const { limit, offset } = livePageSchema.parse(raw);
      return labelled(await paper.accounts.list(userId, limit, offset));
    },
    async createAccount(userId: string, raw: z.input<typeof liveAccountSchema>) {
      return labelled(await paper.accounts.create(userId, liveAccountSchema.parse(raw)));
    },
    async start(userId: string, raw: z.input<typeof liveStartSchema>) {
      const input = liveStartSchema.parse(raw);
      const schedule = paper.strategies.resolveSchedule(input);
      let strategyId = input.strategyId, versionId = input.strategyVersionId;
      let definition: StrategyDefinition;
      let draft = input.draft;
      if (strategyId) {
        const stored = await paper.repo.strategyVersion(userId, strategyId, versionId);
        if (!stored) throw new PaperError('STRATEGY_NOT_FOUND', 'Strategy or strategy version not found.');
        definition = strategyDefinitionSchema.parse(stored.definition);
        versionId = stored.versionId; // Pin the exact version checked before any writes.
      } else {
        const result = await strategies.validate(draft);
        if (!result.ok) throw new PaperError('INVALID_STRATEGY', 'Strategy is invalid.', { fields: result.errors });
        draft = result.draft;
        definition = result.draft.definition;
      }
      supported(definition);
      const symbol = (input.symbol ?? definition.market.symbol).toUpperCase();
      const rules = await paper.repo.symbolRules(PAPER_EXCHANGE, symbol);
      if (!rules || rules.quoteAsset !== PAPER_CURRENCY) throw new PaperError('UNKNOWN_SYMBOL', `${symbol} is not an active ${PAPER_EXCHANGE} ${PAPER_CURRENCY} market.`);
      // Resolve all supplied ownership and compatibility before saving a draft or funding an account.
      if (input.accountId) {
        const account = await paper.accounts.get(userId, input.accountId);
        if (account.status !== 'ACTIVE') throw new PaperError('ACCOUNT_NOT_ACTIVE', 'Choose an active virtual account.');
        const active = await Promise.all((['CREATED', 'RUNNING', 'PAUSED'] as const).map(status => paper.strategies.list(userId, { status, limit: 50, offset: 0 })));
        if (active.some(page => page.strategies.some(i => i.accountId === input.accountId && i.symbol === symbol))) {
          throw new PaperError('STRATEGY_CONFLICT', `A strategy already runs on ${symbol} in this virtual account.`);
        }
      }
      if (!strategyId) {
        const saved = await strategies.create(userId, draft, 'AI_GENERATED', { origin: 'live_paper_test' });
        if (!saved.ok) throw new PaperError('INVALID_STRATEGY', 'Strategy could not be saved.', { fields: saved.errors });
        strategyId = saved.strategy.id;
        versionId = saved.strategy.versionId;
      }
      const accountId = input.accountId ?? (await paper.accounts.create(userId, input.newAccount!)).id;
      return labelled(await paper.strategies.start(userId, strategyId, {
        ...schedule,
        accountId, strategyVersionId: versionId, symbol, timeframe: input.timeframe,
        positionSizing: input.positionSizing, execution: input.execution,
      }));
    },
    async list(userId: string, raw: z.input<typeof liveListSchema> = {}) {
      return labelled(await paper.strategies.list(userId, liveListSchema.parse(raw)));
    },
    async get(userId: string, instanceId: string) {
      return labelled(await paper.strategies.get(userId, z.uuid().parse(instanceId)));
    },
    async control(userId: string, raw: z.input<typeof liveControlSchema>) {
      const input = liveControlSchema.parse(raw);
      let instance: Awaited<ReturnType<PaperTradingServices['strategies']['transition']>>;
      try {
        instance = await paper.strategies.transition(userId, input.instanceId, input.action, { closePosition: input.closePosition });
      } catch (error) {
        // The runner commits STOPPED before attempting an optional close. Report that partial
        // outcome accurately when a missing live quote prevents the closing market order.
        if (input.action !== 'stop' || !input.closePosition || !(error instanceof PaperError) || error.code !== 'STALE_PRICE') throw error;
        const stopped = await paper.strategies.get(userId, input.instanceId);
        if (stopped.status !== 'STOPPED') throw error;
        return labelled({ ...stopped, control: { action: 'stop' as const, closePositionRequested: true, note: 'The strategy stopped, but its position could not close without a fresh quote. The position remains open.' }, warning: { code: error.code, message: error.message } });
      }
      return labelled({ ...instance, control: { action: input.action, closePositionRequested: input.closePosition ?? false,
        note: input.action === 'stop' ? 'Stopping prevents further strategy signals. A requested position close still depends on a fresh quote; inspect the account positions/orders for fill status.'
          : input.action === 'pause' ? 'Protective orders for existing positions continue while strategy signals are paused.' : 'Signals resume from the latest closed candle. Candles from the paused period are not traded retrospectively.' } });
    },
    async account(userId: string, raw: z.input<typeof liveAccountReportSchema>) {
      const { accountId, section, limit, offset } = liveAccountReportSchema.parse(raw);
      await paper.accounts.get(userId, accountId);
      if (section === 'summary') return labelled({ section, summary: await paper.portfolio.summary(userId, accountId) });
      if (section === 'orders') return labelled({ section, ...await paper.orders.list(userId, { accountId, limit, offset }) });
      if (section === 'transactions') return labelled({ section, ...await paper.accounts.transactions(userId, accountId, limit, offset) });
      const result = await paper.positions.list(userId, { accountId, status: section === 'trades' ? 'CLOSED' : 'OPEN', limit, offset });
      return labelled({ section, ...result, ...(section === 'trades' && { note: 'Closed positions with realized P/L. Use the orders section for individual execution records.' }) });
    },
  };
}

export type LiveTestingGateway = ReturnType<typeof createLiveTestingGateway>;
