import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { paperAccounts, refreshTokens, users, watchlists, watchlistItems } from '../../db/schema';
import { globalInstruments } from '../../providers/instruments';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { id } from '../../lib/ids';
import { requireAuth, signAccessToken, signRefreshToken, type AuthUser } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64).optional(),
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function issueTokens(user: { id: string; email: string; username: string }) {
  const payload: AuthUser = { userId: user.id, email: user.email, username: user.username };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await db.insert(refreshTokens).values({
    id: id(),
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: expires,
  });
  return { accessToken, refreshToken };
}

authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof registerSchema>;
    const existing = await db.query.users.findFirst({
      where: (u, { or, eq: e }) => or(e(u.email, body.email.toLowerCase()), e(u.username, body.username.toLowerCase())),
    });
    if (existing) throw new AppError(409, 'Email or username already taken');

    const userId = id();
    const passwordHash = await bcrypt.hash(body.password, 12);
    await db.insert(users).values({
      id: userId,
      email: body.email.toLowerCase(),
      username: body.username.toLowerCase(),
      passwordHash,
      displayName: body.displayName ?? body.username,
    });

    await db.insert(paperAccounts).values({
      id: id(),
      userId,
      cashBalance: config.defaultPaperBalance,
      startingBalance: config.defaultPaperBalance,
    });

    const watchlistId = id();
    await db.insert(watchlists).values({
      id: watchlistId,
      userId,
      name: 'My Watchlist',
      isDefault: true,
    });

    await db.insert(watchlistItems).values(globalInstruments.filter(i => ['BTCUSDT','ETHUSDT','EUR/USD','GBP/USD'].includes(i.symbol)).map(i => ({ id: id(), watchlistId, symbol: i.symbol, exchange: i.exchange, name: i.name })));

    const tokens = await issueTokens({ id: userId, email: body.email.toLowerCase(), username: body.username.toLowerCase() });
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    res.status(201).json({
      user: publicUser(user!),
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof loginSchema>;
    const key = body.emailOrUsername.toLowerCase();
    const user = await db.query.users.findFirst({
      where: (u, { or, eq: e }) => or(e(u.email, key), e(u.username, key)),
    });
    if (!user) throw new AppError(401, 'Invalid credentials');
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new AppError(401, 'Invalid credentials');
    const tokens = await issueTokens(user);
    res.json({ user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', validateBody(z.object({ refreshToken: z.string().min(1) })), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokenHash = hashToken(refreshToken);
    const stored = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
    if (!stored || new Date(stored.expiresAt) < new Date()) {
      throw new AppError(401, 'Invalid refresh token');
    }
    const user = await db.query.users.findFirst({ where: eq(users.id, stored.userId) });
    if (!user) throw new AppError(401, 'User not found');
    await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));
    const tokens = await issueTokens(user);
    res.json({ user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, validateBody(z.object({ refreshToken: z.string().optional() })), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    } else {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, req.user!.userId));
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) });
    if (!user) throw new AppError(404, 'User not found');
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

export function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    theme: user.theme,
    notifyPush: user.notifyPush,
    notifyEmail: user.notifyEmail,
    privacyPublicProfile: user.privacyPublicProfile,
    createdAt: user.createdAt,
  };
}
