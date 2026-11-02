import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../lib/config';
import { AppError } from '../lib/errors';

export type AuthUser = { userId: string; email: string; username: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(payload: AuthUser): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
}

export function signRefreshToken(payload: AuthUser): string {
  return jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: '30d' });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Authentication required'));
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token'));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, config.jwtSecret) as AuthUser;
  } catch {
    // ignore
  }
  next();
}
