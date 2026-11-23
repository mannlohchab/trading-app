import { Elysia } from 'elysia';
import { z } from 'zod';
import { eventStream } from '../../../http/event-stream';
import { parseJson, validationError } from '../../../http/validation';
import type { UserGuard } from '../../identity';
import { AssistantError, type AssistantService, type TurnEvent } from '../application/assistant.service';
import type { ConversationService } from '../application/conversation.service';
import type { MorningDecodeService } from '../application/morning-decode.service';
import { AiProviderError } from '../application/errors';
import { CONVERSATION_LIMITS } from '../domain/conversation';


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

export function aiRoutes(deps: {
  assistant: AssistantService;
  conversations: ConversationService;
  morningDecode: MorningDecodeService;
  requireActiveUser: UserGuard;
}) {
  const { assistant, conversations, morningDecode } = deps;
  const routes = new Elysia({ prefix: '/api/v1/ai' })
    .resolve(({ request }) => deps.requireActiveUser(request));
  routes.onError(({ error, set }) => {
    const body = errorBody(error);
    if (body) { set.status = STATUS[body.code] ?? 500; return body; }
    return undefined;
  });
  const notFound = () => Response.json({ error: 'Conversation not found.', code: 'NOT_FOUND' }, { status: 404 });
  const param = (c: { params: Record<string, string | undefined> }, name: string) => { const v = c.params[name]; return v && id.safeParse(v).success ? v : null; };

  routes.get('/models', c => ({
    models: assistant.availableModels().map(m => ({ id: m.id, label: m.label, supportsTools: m.supportsTools })),
  }));
  routes.get('/usage', async c => (await assistant.usageToday(c.user.id)));

  /**
   * Morning Decode metadata (no transcript). One shared briefing per UTC day.
   * Legacy `/daily-brief` paths stay as aliases for older clients.
   */
  const morningDecodeMeta = async () => (await morningDecode.today());
  const morningDecodeAudio = async () => {
    const audio = await morningDecode.audioToday();
    if (!audio) return Response.json({ error: 'Morning Decode audio is not available yet.', code: 'AUDIO_UNAVAILABLE' }, { status: 404 });
    return new Response(new Uint8Array(audio.bytes), {
      status: 200,
      headers: {
        'Content-Type': audio.contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  };
  routes.get('/morning-decode', morningDecodeMeta);
  routes.get('/morning-decode/audio', morningDecodeAudio);
  routes.get('/daily-brief', morningDecodeMeta);
  routes.get('/daily-brief/audio', morningDecodeAudio);

  routes.post('/conversations', async c => {
    const body = await parseJson(c.request, createBody);
    if ('response' in body) return body.response;
    return Response.json(await conversations.create(c.user.id, body.data.title), { status: 201 });
  }, { parse: 'none' });

  routes.get('/conversations', async c => {
    const status = c.query.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
    const before = c.query.before ? new Date(c.query.before!) : undefined;
    if (before && Number.isNaN(before.getTime())) return validationError({ before: 'Use an ISO timestamp.' });
    const items = await conversations.list(c.user.id, { status, limit: Number(c.query.limit) || undefined, before });
    return ({ conversations: items, nextBefore: items.length ? items.at(-1)!.updatedAt.toISOString() : null });
  });

  routes.get('/conversations/:id', async c => {
    const conversationId = param(c, 'id');
    const conversation = conversationId && (await conversations.get(c.user.id, conversationId));
    return conversation ? (conversation) : notFound();
  });

  routes.patch('/conversations/:id', async c => {
    const conversationId = param(c, 'id');
    if (!conversationId) return notFound();
    const body = await parseJson(c.request, updateBody);
    if ('response' in body) return body.response;
    const updated = await conversations.update(c.user.id, conversationId, body.data);
    return updated ? (updated) : notFound();
  }, { parse: 'none' });

  routes.delete('/conversations/:id', async c => {
    const conversationId = param(c, 'id');
    return conversationId && (await conversations.remove(c.user.id, conversationId)) ? new Response(null, { status: 204 }) : notFound();
  });

  routes.get('/conversations/:id/messages', async c => {
    const conversationId = param(c, 'id');
    const before = c.query.before;
    if (!conversationId || (before && !id.safeParse(before).success)) return notFound();
    const list = await conversations.messages(c.user.id, conversationId, { limit: Number(c.query.limit) || undefined, beforeId: before });
    return list ? ({ messages: list }) : notFound();
  });

  /**
   * Send a message. Default: server-sent events (`user_message`, `status`, `delta`, `block`,
   * `assistant_message`, `error`, `done`). With `"stream": false`: one JSON response.
   */
  routes.post('/conversations/:id/messages', async c => {
    const conversationId = param(c, 'id');
    if (!conversationId) return notFound();
    const body = await parseJson(c.request, messageBody);
    if ('response' in body) return body.response;

    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, c.request.signal]);
    const turn = assistant.sendMessage({ userId: c.user.id, conversationId, content: body.data.content, modelId: body.data.model, signal })[Symbol.asyncIterator]();
    // Pull the first event before responding so validation/quota/config errors get real status codes.
    const first = await turn.next();

    if (!body.data.stream) {
      const events: TurnEvent[] = first.done ? [] : [first.value];
      for (let next = await turn.next(); !next.done; next = await turn.next()) events.push(next.value);
      const pick = <T extends TurnEvent['type']>(type: T) => events.find(e => e.type === type) as Extract<TurnEvent, { type: T }> | undefined;
      return Response.json({ userMessage: pick('user_message')?.message, assistantMessage: pick('assistant_message')?.message }, { status: 201 });
    }

    return eventStream({
      iterator: turn,
      first,
      signal,
      abort: () => controller.abort(),
      errorBody(error) {
        const known = errorBody(error);
        if (!known && !signal.aborted) console.error('[ai] turn failed', error);
        return known ?? { error: 'The assistant failed to reply.', code: 'INTERNAL' };
      },
    });
  }, { parse: 'none' });

  routes.post('/conversations/:id/messages/:messageId/strategies', async c => {
    const conversationId = param(c, 'id'), messageId = param(c, 'messageId');
    if (!conversationId || !messageId) return notFound();
    const body = await parseJson(c.request, saveDraftBody);
    if ('response' in body) return body.response;
    const result = await conversations.saveDraft(c.user.id, conversationId, messageId, body.data.draftId);
    if (result.ok) return Response.json({ strategyId: result.strategyId, alreadySaved: result.alreadySaved }, { status: result.alreadySaved ? 200 : 201 });
    if (result.error === 'INVALID_DRAFT') return Response.json({ error: 'This draft is no longer valid (e.g. its market was delisted).', code: 'INVALID_DRAFT', fields: result.errors }, { status: 422 });
    return Response.json({ error: result.error === 'DRAFT_NOT_FOUND' ? 'Strategy draft not found in this message.' : 'Message not found.', code: result.error }, { status: 404 });
  }, { parse: 'none' });

  return routes;
}
