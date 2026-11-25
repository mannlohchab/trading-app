// Streaming chat for the main assistant through OpenRouter's free Nemotron endpoint.
// Every request is built by freeNemotronChatBody, so a paid id, a fallback list,
// or a non-zero price ceiling cannot be sent.
// Text streams as it arrives. The served model is checked on the first chunk that
// names it, before any of its text is passed on. The cost is only known at the end
// of the stream: anything but exactly zero still fails the call, so the turn is saved
// as interrupted. Holding text back would not prevent a charge, only hide the answer.
import { AiProviderError } from '../application/errors';
import type { ChatMessage, ChatModelProvider, ChatRequest, ChatStreamEvent, ModelUsage, ToolCall } from '../application/ports';
import { assertZeroOpenRouterCost, freeNemotronChatBody } from '../domain/free-nemotron';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ReasoningDetail = { index?: number; type?: string; text?: string; summary?: string; format?: string };

export class OpenRouterChatProvider implements ChatModelProvider {
  readonly name = 'openrouter';

  constructor(private readonly options: { apiKey: string; fetch?: Fetcher; timeoutMs?: number; baseUrl?: string }) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const url = `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 90_000);
    let chatBody: ReturnType<typeof freeNemotronChatBody>;
    try {
      chatBody = freeNemotronChatBody({
        model: request.model,
        messages: request.messages.map(toWire),
        maxTokens: request.maxOutputTokens,
        temperature: request.temperature,
        tools: request.tools,
      });
    } catch (error) {
      throw new AiProviderError('AI_PROVIDER_ERROR', error instanceof Error ? error.message : 'The chat model was refused.', false);
    }
    const body = { ...chatBody, stream: true, stream_options: { include_usage: true } };
    if ('models' in body || 'plugins' in body || 'route' in body || 'data_collection' in body.provider) {
      throw new AiProviderError('AI_PROVIDER_ERROR', 'The chat request included a paid routing option and was not sent.', false);
    }

    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tradinggurukul.app',
          'X-Title': 'TradingGurukul',
        },
        body: JSON.stringify(body),
        signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'The free Nemotron model took too long to respond.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach OpenRouter.', true);
    }
    if (!response.ok) throw await toError(response);
    if (!response.body) throw new AiProviderError('AI_PROVIDER_ERROR', 'OpenRouter returned an empty response.', true);

    const calls: { id: string; name: string; arguments: string }[] = [];
    let reasoning = '';
    let reasoningDetails: ReasoningDetail[] = [];
    let usage: unknown;
    let servedModel = '';
    let finish: string | undefined;
    try {
      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') break;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) throw await streamError(chunk.error);
        if (typeof chunk.model === 'string' && chunk.model && chunk.model !== servedModel) {
          servedModel = chunk.model;
          if (!servedModel.toLowerCase().includes('nemotron')) throw otherModel();
        }
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta;
        const piece = typeof delta?.content === 'number' ? String(delta.content) : delta?.content;
        if (typeof piece === 'string' && piece) yield { type: 'text', delta: piece };
        if (typeof delta?.reasoning === 'string') reasoning += delta.reasoning;
        reasoningDetails = mergeDetails(reasoningDetails, delta?.reasoning_details);
        for (const call of delta?.tool_calls ?? []) {
          const slot = (calls[call.index ?? calls.length] ??= { id: '', name: '', arguments: '' });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) {
            slot.arguments += typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments);
          }
        }
      }
    } catch (error) {
      if (error instanceof AiProviderError || request.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'The free Nemotron model took too long to respond.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'The connection to OpenRouter was interrupted.', true);
    }

    try {
      assertZeroOpenRouterCost({ usage });
    } catch (error) {
      throw new AiProviderError('AI_PROVIDER_QUOTA', error instanceof Error ? error.message : 'OpenRouter reported a cost.', true);
    }
    for (const [index, call] of calls.entries()) {
      if (call?.name) yield { type: 'tool_call', call: { id: call.id || `call_${index + 1}`, name: call.name, arguments: call.arguments } satisfies ToolCall };
    }
    const finishReason = finish === 'stop' || finish === 'length' || finish === 'tool_calls' ? finish : calls.some(call => call?.name) ? 'tool_calls' : 'other';
    const recorded = usage as { prompt_tokens?: unknown; completion_tokens?: unknown };
    const modelUsage: ModelUsage = {
      inputTokens: Number(recorded.prompt_tokens) || 0,
      outputTokens: Number(recorded.completion_tokens) || 0,
      costUnits: 0,
      costUnit: 'usd',
    };
    yield {
      type: 'done',
      finishReason,
      usage: modelUsage,
      ...(reasoning && { reasoning }),
      ...(reasoningDetails.length && { reasoningDetails }),
    };
  }
}

const otherModel = () => new AiProviderError('AI_PROVIDER_QUOTA', 'OpenRouter answered with a different model. The result was discarded.', true);

function toWire(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.reasoning && { reasoning: message.reasoning }),
      ...(message.reasoningDetails?.length && { reasoning_details: message.reasoningDetails }),
      ...(message.toolCalls?.length && {
        tool_calls: message.toolCalls.map(call => ({
          id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
        })),
      }),
    };
  }
  return { role: message.role, content: message.content };
}

function mergeDetails(current: ReasoningDetail[], incoming: unknown): ReasoningDetail[] {
  if (!Array.isArray(incoming)) return current;
  const next = current.map(item => ({ ...item }));
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const detail = item as ReasoningDetail;
    const index = typeof detail.index === 'number' ? detail.index : next.length;
    const existing = next.find(entry => entry.index === index && entry.type === detail.type);
    if (!existing) {
      next.push({ ...detail, index });
      continue;
    }
    if (typeof detail.text === 'string') existing.text = `${existing.text ?? ''}${detail.text}`;
    if (typeof detail.summary === 'string') existing.summary = `${existing.summary ?? ''}${detail.summary}`;
  }
  return next;
}

async function toError(response: Response): Promise<AiProviderError> {
  const text = await response.text().catch(() => '');
  let message = text.slice(0, 180);
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message.slice(0, 180);
  } catch { /* The status code is enough when the body is not JSON. */ }
  if (response.status === 402) return new AiProviderError('AI_PROVIDER_QUOTA', 'OpenRouter refused the free Nemotron request because it would spend credits.', true);
  if (response.status === 401 || response.status === 403) return new AiProviderError('AI_AUTH_ERROR', 'OpenRouter rejected the API key.', false);
  if (response.status === 429) return new AiProviderError('AI_RATE_LIMITED', 'The free Nemotron endpoint is rate-limited. No paid model was tried.', true);
  return new AiProviderError('AI_PROVIDER_ERROR', `OpenRouter could not complete the request (${response.status}): ${message}`, true);
}

function streamError(error: { message?: string; code?: number }): AiProviderError {
  const message = error.message?.slice(0, 180) || 'OpenRouter failed while generating the reply.';
  if (error.code === 402) return new AiProviderError('AI_PROVIDER_QUOTA', message, true);
  if (error.code === 429) return new AiProviderError('AI_RATE_LIMITED', 'The free Nemotron endpoint is rate-limited. No paid model was tried.', true);
  return new AiProviderError('AI_PROVIDER_ERROR', message, true);
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
