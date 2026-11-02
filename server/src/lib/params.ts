import type { Request } from 'express';
import { AppError } from './errors';

export function param(req: Request, name: string): string {
  const value = req.params[name];
  const str = Array.isArray(value) ? value[0] : value;
  if (!str) throw new AppError(400, `Missing path param: ${name}`);
  return str;
}
