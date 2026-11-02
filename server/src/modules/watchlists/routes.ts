import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { watchlistItems, watchlists } from '../../db/schema';
import { AppError, assertFound } from '../../lib/errors';
import { id } from '../../lib/ids';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { requireInstrument } from '../../providers/instruments';
import { getMarketDataProvider } from '../../providers/marketData';
import { param } from '../../lib/params';

export const watchlistsRouter = Router();
watchlistsRouter.use(requireAuth);

watchlistsRouter.get('/', async (req, res, next) => {
  try {
    const lists = await db.query.watchlists.findMany({
      where: eq(watchlists.userId, req.user!.userId),
    });
    res.json({ watchlists: lists });
  } catch (err) {
    next(err);
  }
});

watchlistsRouter.post('/', validateBody(z.object({ name: z.string().min(1).max(64) })), async (req, res, next) => {
  try {
    const { name } = req.body as { name: string };
    const row = { id: id(), userId: req.user!.userId, name, isDefault: false };
    await db.insert(watchlists).values(row);
    res.status(201).json({ watchlist: row });
  } catch (err) {
    next(err);
  }
});

watchlistsRouter.delete('/:id', async (req, res, next) => {
  try {
    const list = assertFound(
      await db.query.watchlists.findFirst({
        where: and(eq(watchlists.id, param(req, 'id')), eq(watchlists.userId, req.user!.userId)),
      }),
    );
    if (list.isDefault) throw new AppError(400, 'Cannot delete default watchlist');
    await db.delete(watchlists).where(eq(watchlists.id, list.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

watchlistsRouter.get('/:id/items', async (req, res, next) => {
  try {
    const list = assertFound(
      await db.query.watchlists.findFirst({
        where: and(eq(watchlists.id, param(req, 'id')), eq(watchlists.userId, req.user!.userId)),
      }),
    );
    const items = await db.query.watchlistItems.findMany({ where: eq(watchlistItems.watchlistId, list.id) });
    const quotes = items.length
      ? await getMarketDataProvider().quotes(items.map((i) => ({ symbol: i.symbol, exchange: i.exchange }))).catch(() => [])
      : [];
    const quoteMap = new Map(quotes.map((q) => [`${q.exchange}:${q.symbol}`, q]));
    res.json({
      watchlist: list,
      items: items.map((item) => ({
        ...item,
        quote: quoteMap.get(`${item.exchange}:${item.symbol}`) ?? null,
      })),
      isDemo: getMarketDataProvider().isDemo,
    });
  } catch (err) {
    next(err);
  }
});

watchlistsRouter.post(
  '/:id/items',
  validateBody(
    z.object({
      symbol: z.string().min(1),
      exchange: z.string().optional(),
      name: z.string().min(1),
      token: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const list = assertFound(
        await db.query.watchlists.findFirst({
          where: and(eq(watchlists.id, param(req, 'id')), eq(watchlists.userId, req.user!.userId)),
        }),
      );
      const body = req.body as { symbol: string; exchange?: string; name: string; token?: string };
      const instrument = requireInstrument(body.symbol, body.exchange);
      const row = {
        id: id(),
        watchlistId: list.id,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        name: body.name,
        token: body.token,
      };
      await db.insert(watchlistItems).values(row);
      res.status(201).json({ item: row });
    } catch (err) {
      next(err);
    }
  },
);

watchlistsRouter.delete('/:id/items/:itemId', async (req, res, next) => {
  try {
    const list = assertFound(
      await db.query.watchlists.findFirst({
        where: and(eq(watchlists.id, param(req, 'id')), eq(watchlists.userId, req.user!.userId)),
      }),
    );
    await db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.id, param(req, 'itemId')), eq(watchlistItems.watchlistId, list.id)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
