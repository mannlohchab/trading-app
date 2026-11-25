// Xiaomi MiMo (Token Plan), OpenAI-compatible: the app's main model for chat, web research and the
// Morning Decode script. One key, one base URL; the key stays server-side.
// Token Plan keys (tp-…) only work on their region's endpoint; the default is Singapore.
import { AiProviderError } from '../application/errors';
import type { BriefScriptLlm } from '../application/brief-script';
import type { ChatMessage, ChatModelProvider, ChatRequest, ChatStreamEvent, ModelUsage, ToolCall, ToolSpec } from '../application/ports';
import type { ResearchMessage, ResearchModel, ResearchTurn } from '../application/web-research-agent';

export const MIMO_DEFAULT_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type MimoOptions = { apiKey: string; baseUrl?: string; fetch?: Fetcher; timeoutMs?: number };
type WireToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: unknown } };

/** POSTs to /chat/completions and maps failures to AiProviderError (never echoing the key). */
async function post(options: MimoOptions, body: Record<string, unknown>, signal: AbortSignal | undefined, defaultTimeoutMs: number, what: string): Promise<{ response: Response; timeout: AbortSignal }> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${(options.baseUrl ?? MIMO_DEFAULT_BASE_URL).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', `MiMo took too long to ${what}.`, true);
    throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach MiMo.', true);
  }
  if (!response.ok) throw await toError(response, what);
  return { response, timeout };
}

async function toError(response: Response, what: string): Promise<AiProviderError> {
  const text = await response.text().catch(() => '');
  let message = text.slice(0, 180);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message.slice(0, 180);
  } catch { /* status code is enough */ }
  if (response.status === 401 || response.status === 403) return new AiProviderError('AI_AUTH_ERROR', 'MiMo rejected the API key (check the key and that MIMO_BASE_URL is its region).', false);
  if (response.status === 402) return new AiProviderError('AI_PROVIDER_QUOTA', 'The MiMo plan has no quota left.', false);
  if (response.status === 429) return new AiProviderError('AI_RATE_LIMITED', 'MiMo is rate-limiting requests right now.', true);
  if (response.status === 404) return new AiProviderError('AI_MODEL_UNAVAILABLE', `MiMo could not ${what}: ${message}`, true);
  return new AiProviderError('AI_PROVIDER_ERROR', `MiMo could not ${what} (${response.status}): ${message}`, response.status >= 500);
}

const wireTools = (tools?: ToolSpec[]) => (tools?.length ? { tools: tools.map(t => ({ type: 'function', function: t })), tool_choice: 'auto' } : {});

/** Reasoning is not sent back: MiMo answers tool results correctly without it, and it saves tokens. */
function toWire(message: ChatMessage | ResearchMessage): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.toolCalls?.length && {
        tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
      }),
    };
  }
  return { role: message.role, content: message.content };
}

const usageOf = (raw: unknown): ModelUsage => {
  const u = (raw ?? {}) as { prompt_tokens?: unknown; completion_tokens?: unknown };
  return { inputTokens: Number(u.prompt_tokens) || 0, outputTokens: Number(u.completion_tokens) || 0 };
};

/** Streaming chat for the assistant. Text and reasoning are passed on as they arrive. */
export class MimoChatProvider implements ChatModelProvider {
  readonly name = 'mimo';

  constructor(private readonly options: MimoOptions) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const { response, timeout } = await post(this.options, {
      model: request.model,
      messages: request.messages.map(toWire),
      max_tokens: request.maxOutputTokens,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      // MiMo accepts reasoning_effort low|medium|high, and thinking.type to switch thinking off.
      ...(request.disableThinking
        ? { thinking: { type: 'disabled' } }
        : request.reasoningEffort && { reasoning_effort: request.reasoningEffort }),
      ...wireTools(request.tools),
      stream: true,
      stream_options: { include_usage: true },
    }, request.signal, 90_000, 'reply');
    if (!response.body) throw new AiProviderError('AI_PROVIDER_ERROR', 'MiMo returned an empty response.', true);

    const calls: { id: string; name: string; arguments: string }[] = [];
    let reasoning = '';
    let usage: unknown;
    let finish: string | undefined;
    try {
      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') break;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) throw new AiProviderError('AI_PROVIDER_ERROR', String(chunk.error.message ?? 'MiMo failed while replying.').slice(0, 180), true);
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta;
        if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content;
        if (typeof delta?.content === 'string' && delta.content) yield { type: 'text', delta: delta.content };
        for (const call of (delta?.tool_calls ?? []) as WireToolCall[]) {
          const slot = (calls[call.index ?? calls.length] ??= { id: '', name: '', arguments: '' });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) slot.arguments += typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments);
        }
      }
    } catch (error) {
      if (error instanceof AiProviderError || request.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'MiMo took too long to reply.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'The connection to MiMo was interrupted.', true);
    }
    for (const [index, call] of calls.entries()) {
      if (call?.name) yield { type: 'tool_call', call: { id: call.id || `call_${index + 1}`, name: call.name, arguments: call.arguments } satisfies ToolCall };
    }
    const named = calls.some(c => c?.name);
    const finishReason = finish === 'stop' || finish === 'length' || finish === 'tool_calls' ? finish : named ? 'tool_calls' : 'other';
    yield { type: 'done', finishReason, usage: usageOf(usage), ...(reasoning && { reasoning }) };
  }
}

/** One non-streaming completion for the web-research sub-agent. */
export class MimoResearchModel implements ResearchModel {
  constructor(private readonly options: MimoOptions & { model: string }) {}

  async complete(input: { messages: ResearchMessage[]; tools?: ToolSpec[]; maxOutputTokens: number; signal?: AbortSignal }): Promise<ResearchTurn> {
    const { response } = await post(this.options, {
      model: this.options.model,
      messages: input.messages.map(toWire),
      max_tokens: input.maxOutputTokens,
      temperature: 0.2,
      ...wireTools(input.tools),
    }, input.signal, 45_000, 'research');
    const json = await response.json() as { choices?: { message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: WireToolCall[] | null } }[] };
    const message = json.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).flatMap((call, index) => {
      const name = call.function?.name?.trim();
      if (!name) return [];
      const args = call.function?.arguments;
      return [{ id: call.id || `call_${index + 1}`, name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) }];
    });
    const reasoning = typeof message?.reasoning_content === 'string' && message.reasoning_content ? message.reasoning_content : undefined;
    return { content: typeof message?.content === 'string' ? message.content.trim() : '', toolCalls, ...(reasoning && { reasoning }), model: this.options.model };
  }
}

/** Writes the Morning Decode script. */
export class MimoScriptLlm implements BriefScriptLlm {
  readonly name = 'mimo';

  constructor(private readonly options: MimoOptions & { model: string }) {}

  async complete(input: { system: string; user: string; signal?: AbortSignal }): Promise<{ text: string; model: string }> {
    const { response } = await post(this.options, {
      model: this.options.model,
      temperature: 0.4,
      max_tokens: 6000,
      messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
    }, input.signal, 180_000, 'write the briefing');
    const json = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new AiProviderError('AI_PROVIDER_ERROR', 'MiMo returned an empty briefing script.', true);
    return { text, model: this.options.model };
  }
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}
