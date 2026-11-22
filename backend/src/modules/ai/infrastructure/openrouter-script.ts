// OpenRouter chat completions for Morning Decode scripts (e.g. free Nemotron). Key stays server-side.
import { AiProviderError } from '../application/errors';
import type { BriefScriptLlm } from '../application/brief-script';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class OpenRouterScriptLlm implements BriefScriptLlm {
  readonly name = 'openrouter';

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      fetch?: Fetcher;
      timeoutMs?: number;
      baseUrl?: string;
    },
  ) {}

  async complete(input: { system: string; user: string; signal?: AbortSignal }): Promise<{ text: string; model: string }> {
    const url = `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 180_000);
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
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.4,
          // Nemotron counts reasoning against this budget before producing the spoken script.
          max_tokens: 6000,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
        signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'OpenRouter took too long to write the briefing.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach OpenRouter.', true);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError('AI_AUTH_ERROR', 'OpenRouter rejected the API key for script generation.', false);
      }
      // Free endpoints are rate-limited; surface a clear code without leaking headers/keys.
      throw new AiProviderError(
        response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR',
        `OpenRouter script failed (${response.status}): ${body.slice(0, 200)}`,
        response.status >= 500 || response.status === 429,
      );
    }
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new AiProviderError('AI_PROVIDER_ERROR', 'OpenRouter returned an empty briefing script.', true);
    return { text, model: this.options.model };
  }
}
