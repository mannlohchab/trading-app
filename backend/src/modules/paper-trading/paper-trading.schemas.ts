// Strict request schemas. User ids never come from requests.
import { z } from 'zod';
import { TIMEFRAMES } from '../market/domain/market-options';

const decimal = (label: string) =>
  z.union([z.string(), z.number()])
    .transform(v => String(v).trim())
    .refine(v => /^\d+(\.\d{1,12})?$/.test(v) && Number(v) > 0, `${label} must be a positive decimal number.`);

const page = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) };

export const createAccountSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  initialBalance: decimal('initialBalance').optional(),
});

export const updateAccountSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
}).refine(v => Object.keys(v).length > 0, 'Provide name or status.');

export const placeOrderSchema = z.strictObject({
  accountId: z.uuid(),
  symbol: z.string().min(2).max(30),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['MARKET', 'LIMIT', 'STOP_MARKET']),
  quantity: decimal('quantity'),
  price: decimal('price').optional(),
  stopPrice: decimal('stopPrice').optional(),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).default('GTC'),
  reduceOnly: z.boolean().default(false),
  /** Repeat a request with the same key to get the same order back instead of a duplicate. */
  clientOrderId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
}).superRefine((o, ctx) => {
  if (o.type === 'LIMIT' && !o.price) ctx.addIssue({ code: 'custom', path: ['price'], message: 'LIMIT orders need a price.' });
  if (o.type !== 'LIMIT' && o.price) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Only LIMIT orders take a price.' });
  if (o.type === 'STOP_MARKET' && !o.stopPrice) ctx.addIssue({ code: 'custom', path: ['stopPrice'], message: 'STOP_MARKET orders need a stopPrice.' });
  if (o.type !== 'STOP_MARKET' && o.stopPrice) ctx.addIssue({ code: 'custom', path: ['stopPrice'], message: 'Only STOP_MARKET orders take a stopPrice.' });
  if (o.type !== 'LIMIT' && o.timeInForce !== 'GTC') ctx.addIssue({ code: 'custom', path: ['timeInForce'], message: 'Only LIMIT orders take IOC/FOK.' });
});
export type PlaceOrderRequest = z.infer<typeof placeOrderSchema>;

export const listOrdersQuery = z.object({
  ...page,
  accountId: z.uuid().optional(),
  status: z.enum(['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED']).optional(),
  symbol: z.string().max(30).optional(),
});
export const listPositionsQuery = z.object({ ...page, accountId: z.uuid().optional(), status: z.enum(['OPEN', 'CLOSED']).optional() });
export const pageQuery = z.object(page);
export const listStrategiesQuery = z.object({ ...page, status: z.enum(['CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED']).optional() });

export const startStrategySchema = z.strictObject({
  accountId: z.uuid(),
  strategyVersionId: z.uuid().optional(),
  symbol: z.string().min(2).max(30).optional(),
  timeframe: z.enum(TIMEFRAMES).optional(),
  positionSizing: z.strictObject({ type: z.literal('percent_of_equity'), value: decimal('positionSizing.value').refine(v => Number(v) <= 100, 'At most 100.') }).optional(),
  execution: z.strictObject({
    commissionPercent: z.union([z.string(), z.number()]).transform(v => String(v)).refine(v => /^\d+(\.\d{1,12})?$/.test(v) && Number(v) <= 5, 'commissionPercent must be 0–5.').optional(),
    slippageBps: z.number().int().min(0).max(1000).optional(),
  }).optional(),
});
export type StartStrategyRequest = z.infer<typeof startStrategySchema>;

export const stopStrategySchema = z.strictObject({ closePosition: z.boolean().default(false) });
