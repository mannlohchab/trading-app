// Cloudflare Workers AI via its OpenAI-compatible chat completions endpoint (streaming + tools).
import { parseJsonLossless } from '../../../db/json';
import { AiProviderError } from '../application/errors';
import type { ChatMessage, ChatModelProvider, ChatRequest, ChatStreamEvent, ModelUsage, ToolCall } from '../application/ports';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class WorkersAiProvider implements ChatModelProvider {
  readonly name = 'workers-ai';

  constructor(private readonly options: { accountId: string; apiToken: string; fetch?: Fetcher; timeoutMs?: number; baseUrl?: string }) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const url = `${this.options.baseUrl ?? 'https://api.cloudflare.com/client/v4'}/accounts/${this.options.accountId}/ai/v1/chat/completions`;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toWire),
          ...(request.tools?.length && { tools: request.tools.map(t => ({ type: 'function', function: t })) }),
          max_tokens: request.maxOutputTokens,
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.reasoningEffort && { reasoning_effort: request.reasoningEffort }),
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'The AI model took too long to respond.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach Cloudflare Workers AI.', true);
    }
    if (!response.ok) throw await toError(response);
    if (!response.body) throw new AiProviderError('AI_PROVIDER_ERROR', 'Workers AI returned an empty response.', true);

    const calls: { id: string; name: string; arguments: string }[] = [];
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let finish: string | undefined;
    try {
      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') break;
        let chunk: any;
        // Workers AI sends number-only tokens (e.g. "2113.90") as JSON numbers; parse losslessly so
        // no digit is dropped, then treat the token as text.
        try { chunk = parseJsonLossless(data); } catch { continue; }
        if (chunk.errors?.length || chunk.error) throw new AiProviderError('AI_PROVIDER_ERROR', 'Workers AI failed while generating the reply.', true);
        if (chunk.usage) usage = toUsage(chunk.usage);
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta;
        const piece = typeof delta?.content === 'number' ? String(delta.content) : delta?.content;
        if (typeof piece === 'string' && piece) yield { type: 'text', delta: piece };
        for (const tc of delta?.tool_calls ?? []) {
          const slot = (calls[tc.index ?? calls.length] ??= { id: '', name: '', arguments: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        }
      }
    } catch (error) {
      if (error instanceof AiProviderError || request.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'The AI model took too long to respond.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'The connection to Workers AI was interrupted.', true);
    }

    for (const [i, call] of calls.entries()) {
      if (call?.name) yield { type: 'tool_call', call: { id: call.id || `call_${i + 1}`, name: call.name, arguments: call.arguments } satisfies ToolCall };
    }
    const finishReason = finish === 'stop' || finish === 'length' || finish === 'tool_calls' ? finish : calls.length ? 'tool_calls' : 'other';
    yield { type: 'done', finishReason, usage };
  }
}

function toWire(m: ChatMessage) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content ?? '',
      ...(m.toolCalls?.length && { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }),
    };
  }
  return { role: m.role, content: m.content };
}

const toUsage = (u: any): ModelUsage => ({
  inputTokens: Number(u.prompt_tokens) || 0,
  outputTokens: Number(u.completion_tokens) || 0,
  ...(typeof u.neurons === 'number' && { costUnits: u.neurons, costUnit: 'neurons' }),
});

async function toError(response: Response): Promise<AiProviderError> {
  const body = (await response.json().catch(() => null)) as { errors?: { code?: number; message?: string }[] } | null;
  const first = body?.errors?.[0];
  const message = first?.message ?? '';
  if (first?.code === 3036 || /daily free allocation|neurons/i.test(message)) {
    return new AiProviderError('AI_PROVIDER_QUOTA', 'The AI service has used up its daily allowance. It resets at 00:00 UTC.', false);
  }
  if (first?.code === 5035 || /not available on the Workers Free plan|requires a paid/i.test(message)) {
    return new AiProviderError('AI_MODEL_UNAVAILABLE', 'This AI model is not available on the current Cloudflare plan.', true);
  }
  if (response.status === 401 || response.status === 403) {
    return new AiProviderError('AI_AUTH_ERROR', 'The server\'s Cloudflare AI credentials were rejected.', false);
  }
  if (response.status === 429) return new AiProviderError('AI_RATE_LIMITED', 'The AI service is busy. Try again shortly.', true);
  return new AiProviderError('AI_PROVIDER_ERROR', `Workers AI could not complete the request (${response.status}).`, true);
}

/** Yields the `data:` payloads of a server-sent-events stream. */
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
