import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { follows, posts, users } from '../../db/schema';
import { AppError, assertFound } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { publicUser } from '../auth/routes';
import { portfolioSummary } from '../trading/engine';
import { param } from '../../lib/params';

export const usersRouter = Router();

usersRouter.get('/me/overview', requireAuth, async (req, res, next) => {
  try {
    const user = assertFound(await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) }));
    const portfolio = await portfolioSummary(req.user!.userId);
    const postCount = await db.select({ value: count() }).from(posts).where(eq(posts.userId, user.id));
    const followerCount = await db.select({ value: count() }).from(follows).where(eq(follows.followingId, user.id));
    const followingCount = await db.select({ value: count() }).from(follows).where(eq(follows.followerId, user.id));
    res.json({
      user: publicUser(user),
      portfolio,
      community: {
        posts: postCount[0]?.value ?? 0,
        followers: followerCount[0]?.value ?? 0,
        following: followingCount[0]?.value ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch(
  '/me',
  requireAuth,
  validateBody(
    z.object({
      displayName: z.string().min(1).max(64).optional(),
      bio: z.string().max(280).optional(),
      avatarUrl: z.string().optional(),
      theme: z.enum(['dark', 'light', 'system']).optional(),
      notifyPush: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      privacyPublicProfile: z.boolean().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      await db
        .update(users)
        .set({ ...req.body, updatedAt: new Date().toISOString() })
        .where(eq(users.id, req.user!.userId));
      const user = assertFound(await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) }));
      res.json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

usersRouter.post(
  '/me/password',
  requireAuth,
  validateBody(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) })),
  async (req, res, next) => {
    try {
      const body = req.body as { currentPassword: string; newPassword: string };
      const user = assertFound(await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) }));
      const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
      if (!ok) throw new AppError(400, 'Current password is incorrect');
      const passwordHash = await bcrypt.hash(body.newPassword, 12);
      await db.update(users).set({ passwordHash, updatedAt: new Date().toISOString() }).where(eq(users.id, user.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

usersRouter.get('/:username', requireAuth, async (req, res, next) => {
  try {
    const user = assertFound(
      await db.query.users.findFirst({ where: eq(users.username, param(req, 'username').toLowerCase()) }),
    );
    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});
