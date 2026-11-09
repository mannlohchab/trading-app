import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
import { AssistantError, type AssistantService, type TurnEvent } from '../application/assistant.service';
import type { ConversationService } from '../application/conversation.service';
import { AiProviderError } from '../application/errors';
import { CONVERSATION_LIMITS } from '../domain/conversation';

type C = Context<{ Variables: AuthVariables }>;

const STATUS: Record<string, 400 | 404 | 409 | 429 | 502 | 503 | 504> = {
  VALIDATION_ERROR: 400, UNKNOWN_MODEL: 400, NOT_FOUND: 404, CONVERSATION_BUSY: 409,
  DAILY_TURN_LIMIT: 429, DAILY_TOKEN_LIMIT: 429, AI_RATE_LIMITED: 429,
  AI_NOT_CONFIGURED: 503, AI_PROVIDER_QUOTA: 503, AI_AUTH_ERROR: 503, AI_MODEL_UNAVAILABLE: 503,
  AI_TIMEOUT: 504, AI_PROVIDER_ERROR: 502,
};

function errorBody(error: unknown) {
  if (error instanceof AssistantError) return { error: error.message, code: error.code, ...error.details };
  if (error instanceof AiProviderError) return { error: error.message, code: error.code };
  return null;
}

const id = z.uuid();
const createBody = z.strictObject({ title: z.string().max(200).optional() });
const updateBody = z.strictObject({ title: z.string().min(1).max(200).optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine(v => Object.keys(v).length > 0, 'Provide title or status.');
const messageBody = z.strictObject({
  content: z.string().min(1).max(CONVERSATION_LIMITS.messageMaxChars),
  model: z.string().max(60).optional(),
  stream: z.boolean().default(true),
});
const saveDraftBody = z.strictObject({ draftId: z.string().min(1).max(40) });

export function aiRoutes(deps: { assistant: AssistantService; conversations: ConversationService; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const { assistant, conversations } = deps;
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/ai');
  routes.use('*', deps.requireActiveUser);
  routes.onError((error, c) => {
    const body = errorBody(error);
    if (body) return c.json(body, STATUS[body.code] ?? 500);
    throw error;
  });
  const notFound = (c: C) => c.json({ error: 'Conversation not found.', code: 'NOT_FOUND' }, 404);
  const param = (c: C, name: string) => { const v = c.req.param(name); return v && id.safeParse(v).success ? v : null; };

  routes.get('/models', c => c.json({
    models: assistant.availableModels().map(m => ({ id: m.id, label: m.label, supportsTools: m.supportsTools })),
  }));
  routes.get('/usage', async c => c.json(await assistant.usageToday(c.var.user.id)));

  routes.post('/conversations', async c => {
    const body = await parseJson(c, createBody);
    if ('response' in body) return body.response;
    return c.json(await conversations.create(c.var.user.id, body.data.title), 201);
  });

  routes.get('/conversations', async c => {
    const status = c.req.query('status') === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
    const before = c.req.query('before') ? new Date(c.req.query('before')!) : undefined;
    if (before && Number.isNaN(before.getTime())) return validationError(c, { before: 'Use an ISO timestamp.' });
    const items = await conversations.list(c.var.user.id, { status, limit: Number(c.req.query('limit')) || undefined, before });
    return c.json({ conversations: items, nextBefore: items.length ? items.at(-1)!.updatedAt.toISOString() : null });
  });

  routes.get('/conversations/:id', async c => {
    const conversationId = param(c, 'id');
    const conversation = conversationId && (await conversations.get(c.var.user.id, conversationId));
    return conversation ? c.json(conversation) : notFound(c);
  });

  routes.patch('/conversations/:id', async c => {
    const conversationId = param(c, 'id');
    if (!conversationId) return notFound(c);
    const body = await parseJson(c, updateBody);
    if ('response' in body) return body.response;
    const updated = await conversations.update(c.var.user.id, conversationId, body.data);
    return updated ? c.json(updated) : notFound(c);
  });

  routes.delete('/conversations/:id', async c => {
    const conversationId = param(c, 'id');
    return conversationId && (await conversations.remove(c.var.user.id, conversationId)) ? c.body(null, 204) : notFound(c);
  });

  routes.get('/conversations/:id/messages', async c => {
    const conversationId = param(c, 'id');
    const before = c.req.query('before');
    if (!conversationId || (before && !id.safeParse(before).success)) return notFound(c);
    const list = await conversations.messages(c.var.user.id, conversationId, { limit: Number(c.req.query('limit')) || undefined, beforeId: before });
    return list ? c.json({ messages: list }) : notFound(c);
  });

  /**
   * Send a message. Default: server-sent events (`user_message`, `status`, `delta`, `block`,
   * `assistant_message`, `error`, `done`). With `"stream": false`: one JSON response.
   */
  routes.post('/conversations/:id/messages', async c => {
    const conversationId = param(c, 'id');
    if (!conversationId) return notFound(c);
    const body = await parseJson(c, messageBody);
    if ('response' in body) return body.response;

    const controller = new AbortController();
    const turn = assistant.sendMessage({ userId: c.var.user.id, conversationId, content: body.data.content, modelId: body.data.model, signal: controller.signal })[Symbol.asyncIterator]();
    // Pull the first event before responding so validation/quota/config errors get real status codes.
    const first = await turn.next();

    if (!body.data.stream) {
      const events: TurnEvent[] = first.done ? [] : [first.value];
      for (let next = await turn.next(); !next.done; next = await turn.next()) events.push(next.value);
      const pick = <T extends TurnEvent['type']>(type: T) => events.find(e => e.type === type) as Extract<TurnEvent, { type: T }> | undefined;
      return c.json({ userMessage: pick('user_message')?.message, assistantMessage: pick('assistant_message')?.message }, 201);
    }

    return streamSSE(c, async stream => {
      stream.onAbort(() => controller.abort());
      const send = (event: TurnEvent) => stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      try {
        if (!first.done) await send(first.value);
        for (let next = await turn.next(); !next.done; next = await turn.next()) await send(next.value);
        await stream.writeSSE({ event: 'done', data: '{}' });
      } catch (error) {
        const known = errorBody(error);
        if (!known && !controller.signal.aborted) console.error('[ai] turn failed', error);
        if (!controller.signal.aborted) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify(known ?? { error: 'The assistant failed to reply.', code: 'INTERNAL' }) });
        }
      }
    });
  });

  routes.post('/conversations/:id/messages/:messageId/strategies', async c => {
    const conversationId = param(c, 'id'), messageId = param(c, 'messageId');
    if (!conversationId || !messageId) return notFound(c);
    const body = await parseJson(c, saveDraftBody);
    if ('response' in body) return body.response;
    const result = await conversations.saveDraft(c.var.user.id, conversationId, messageId, body.data.draftId);
    if (result.ok) return c.json({ strategyId: result.strategyId, alreadySaved: result.alreadySaved }, result.alreadySaved ? 200 : 201);
    if (result.error === 'INVALID_DRAFT') return c.json({ error: 'This draft is no longer valid (e.g. its market was delisted).', code: 'INVALID_DRAFT', fields: result.errors }, 422);
    return c.json({ error: result.error === 'DRAFT_NOT_FOUND' ? 'Strategy draft not found in this message.' : 'Message not found.', code: result.error }, 404);
  });

  return routes;
}
