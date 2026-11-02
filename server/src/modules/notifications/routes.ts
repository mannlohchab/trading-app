import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { notifications } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { param } from '../../lib/params';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const rows = await db.query.notifications.findMany({
      where: eq(notifications.userId, req.user!.userId),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    });
    res.json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, param(req, 'id')));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
