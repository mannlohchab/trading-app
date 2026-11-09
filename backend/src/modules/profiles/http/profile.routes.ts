import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
import type { ProfileService, UpdateResult } from '../application/profile.service';
import { AI_EXPLANATION_LEVELS, AI_RESPONSE_STYLES, CHART_TYPES, MARKET_TYPES, THEMES, TIMEFRAMES } from '../domain/preference-options';

const atLeastOne = (value: object) => Object.keys(value).length > 0;

const profilePatch = z
  .strictObject({
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    timezone: z.string(),
  })
  .partial()
  .refine(atLeastOne, 'Provide at least one field to update.');

const preferencesPatch = z
  .strictObject({
    general: z
      .strictObject({ language: z.string(), timezone: z.string(), currency: z.string(), theme: z.enum(THEMES), notificationsEnabled: z.boolean() })
      .partial(),
    trading: z
      .strictObject({
        exchange: z.string().max(30).nullable(),
        marketType: z.enum(MARKET_TYPES),
        tradingPair: z.string().max(50).nullable(),
        timeframe: z.enum(TIMEFRAMES),
        chartType: z.enum(CHART_TYPES),
      })
      .partial(),
    ai: z
      .strictObject({ responseStyle: z.enum(AI_RESPONSE_STYLES), explanationLevel: z.enum(AI_EXPLANATION_LEVELS), language: z.string().nullable() })
      .partial(),
  })
  .partial()
  .refine(atLeastOne, 'Provide at least one section to update.');

function sendResult<T>(c: Parameters<MiddlewareHandler>[0], result: UpdateResult<T>) {
  if (result.ok) return c.json(result.value);
  if (result.error === 'VALIDATION_ERROR') return validationError(c, result.fields);
  if (result.error === 'USERNAME_TAKEN') return c.json({ error: 'That username is taken.', code: 'USERNAME_TAKEN' }, 409);
  return c.json({ error: 'Account not found.', code: 'NOT_FOUND' }, 404);
}

/** /api/v1/me/profile and /api/v1/me/preferences, for ACTIVE users only. */
export function profileRoutes(service: ProfileService, requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>) {
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/me');
  routes.use('/profile', requireActiveUser);
  routes.use('/preferences', requireActiveUser);

  routes.get('/profile', async c => {
    const profile = await service.getProfile(c.var.user.id);
    return profile ? c.json(profile) : c.json({ error: 'Account not found.', code: 'NOT_FOUND' }, 404);
  });
  routes.patch('/profile', async c => {
    const body = await parseJson(c, profilePatch);
    if ('response' in body) return body.response;
    return sendResult(c, await service.updateProfile(c.var.user.id, body.data));
  });

  routes.get('/preferences', async c => c.json(await service.getPreferences(c.var.user.id)));
  routes.patch('/preferences', async c => {
    const body = await parseJson(c, preferencesPatch);
    if ('response' in body) return body.response;
    return sendResult(c, await service.updatePreferences(c.var.user.id, body.data));
  });

  return routes;
}
