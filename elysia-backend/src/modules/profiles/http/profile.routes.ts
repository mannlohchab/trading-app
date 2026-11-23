import { Elysia } from 'elysia';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { UserGuard } from '../../identity';
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

function sendResult<T>(result: UpdateResult<T>) {
  if (result.ok) return (result.value);
  if (result.error === 'VALIDATION_ERROR') return validationError(result.fields);
  if (result.error === 'USERNAME_TAKEN') return Response.json({ error: 'That username is taken.', code: 'USERNAME_TAKEN' }, { status: 409 });
  return Response.json({ error: 'Account not found.', code: 'NOT_FOUND' }, { status: 404 });
}

/** /api/v1/me/profile and /api/v1/me/preferences, for ACTIVE users only. */
export function profileRoutes(service: ProfileService, requireActiveUser: UserGuard) {
  const routes = new Elysia({ prefix: '/api/v1/me' }).resolve(({ request }) => requireActiveUser(request));

  routes.get('/profile', async c => {
    const profile = await service.getProfile(c.user.id);
    return profile ? (profile) : Response.json({ error: 'Account not found.', code: 'NOT_FOUND' }, { status: 404 });
  }, { parse: 'none' });
  routes.patch('/profile', async c => {
    const body = await parseJson(c.request, profilePatch);
    if ('response' in body) return body.response;
    return sendResult(await service.updateProfile(c.user.id, body.data));
  }, { parse: 'none' });

  routes.get('/preferences', async c => (await service.getPreferences(c.user.id)));
  routes.patch('/preferences', async c => {
    const body = await parseJson(c.request, preferencesPatch);
    if ('response' in body) return body.response;
    return sendResult(await service.updatePreferences(c.user.id, body.data));
  }, { parse: 'none' });

  return routes;
}
