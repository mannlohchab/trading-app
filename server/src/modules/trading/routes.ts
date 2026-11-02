import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { orders, transactions } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { cancelOrder, placeOrder, portfolioSummary } from './engine';
import { param } from '../../lib/params';

export const tradingRouter = Router();
tradingRouter.use(requireAuth);

const orderSchema = z.object({
  symbol: z.string().min(1),
  exchange: z.string().optional(),
  name: z.string().optional(),
  side: z.enum(['BUY', 'SELL']),
  orderType: z.enum(['MARKET', 'LIMIT']),
  quantity: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
});

tradingRouter.get('/portfolio', async (req, res, next) => {
  try {
    const summary = await portfolioSummary(req.user!.userId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

tradingRouter.get('/orders', async (req, res, next) => {
  try {
    const rows = await db.query.orders.findMany({
      where: eq(orders.userId, req.user!.userId),
      orderBy: [desc(orders.createdAt)],
      limit: 100,
    });
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

tradingRouter.get('/transactions', async (req, res, next) => {
  try {
    const rows = await db.query.transactions.findMany({
      where: eq(transactions.userId, req.user!.userId),
      orderBy: [desc(transactions.createdAt)],
      limit: 100,
    });
    res.json({ transactions: rows });
  } catch (err) {
    next(err);
  }
});

tradingRouter.post('/orders', validateBody(orderSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof orderSchema>;
    const result = await placeOrder({ userId: req.user!.userId, ...body });
    const summary = await portfolioSummary(req.user!.userId);
    res.status(201).json({ ...result, portfolio: summary });
  } catch (err) {
    next(err);
  }
});

tradingRouter.delete('/orders/:id', async (req, res, next) => {
  try {
    await cancelOrder(req.user!.userId, param(req, 'id'));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
