// Non-streaming chat completion for the research sub-agent.
// Every request is built by freeNemotronChatBody, and a completion is returned
// only when OpenRouter reports an exact zero cost.
import { AiProviderError } from '../application/errors';
import type { ToolSpec } from '../application/ports';
import { assertZeroOpenRouterCost, freeNemotronChatBody } from '../domain/free-nemotron';
import type { ResearchMessage, ResearchModel, ResearchTurn } from '../application/web-research-agent';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class OpenRouterResearchModel implements ResearchModel {
  constructor(private readonly options: {
    apiKey: string;
    model: string;
    fetch?: Fetcher;
    timeoutMs?: number;
    baseUrl?: string;
  }) {}

  async complete(input: { messages: ResearchMessage[]; tools?: ToolSpec[]; maxOutputTokens: number; signal?: AbortSignal }): Promise<ResearchTurn> {
    const url = `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 45_000);
    const body = freeNemotronChatBody({
      model: this.options.model,
      messages: input.messages.map(toWire),
      maxTokens: input.maxOutputTokens,
      tools: input.tools,
    });
    // The paid-routing keys must never appear, even if a caller adds them later.
    if ('models' in body || 'plugins' in body || 'route' in body) {
      throw new AiProviderError('AI_PROVIDER_ERROR', 'The research request included a paid routing option and was not sent.', false);
    }
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tradinggurukul.app',
          'X-Title': 'TradingGurukul Research',
        },
        body: JSON.stringify(body),
        signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'The free research model took too long to respond.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach OpenRouter.', true);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 402) {
        throw new AiProviderError('AI_PROVIDER_QUOTA', 'OpenRouter refused the research request because it would spend credits.', false);
      }
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError('AI_AUTH_ERROR', 'OpenRouter rejected the API key for research.', false);
      }
      throw new AiProviderError(
        response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR',
        response.status === 429
          ? 'The free Nemotron endpoint is rate-limited. No paid model was tried.'
          : `OpenRouter research failed (${response.status}): ${text.slice(0, 180)}`,
        response.status >= 500 || response.status === 429,
      );
    }
    const json = await response.json() as {
      model?: unknown;
      usage?: unknown;
      choices?: { message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown; tool_calls?: WireToolCall[] } }[];
    };
    try {
      assertZeroOpenRouterCost(json);
    } catch (error) {
      throw new AiProviderError('AI_PROVIDER_QUOTA', error instanceof Error ? error.message : 'OpenRouter reported a cost.', false);
    }
    if (typeof json.model === 'string' && json.model && !json.model.toLowerCase().includes('nemotron')) {
      throw new AiProviderError('AI_PROVIDER_QUOTA', 'OpenRouter answered with a different model. The result was discarded.', false);
    }
    const message = json.choices?.[0]?.message;
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    const reasoning = typeof message?.reasoning === 'string'
      ? message.reasoning
      : typeof message?.reasoning_content === 'string' ? message.reasoning_content : undefined;
    const toolCalls = (message?.tool_calls ?? []).flatMap((call, index) => {
      const name = call.function?.name?.trim();
      if (!name) return [];
      const args = call.function?.arguments;
      return [{
        id: call.id || `call_${index + 1}`,
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      }];
    });
    return { content, toolCalls, ...(reasoning && { reasoning }), model: this.options.model };
  }
}

type WireToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };

function toWire(message: ResearchMessage): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.reasoning && { reasoning: message.reasoning }),
      ...(message.toolCalls?.length && {
        tool_calls: message.toolCalls.map(call => ({
          id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
        })),
      }),
    };
  }
  return { role: message.role, content: message.content };
}
