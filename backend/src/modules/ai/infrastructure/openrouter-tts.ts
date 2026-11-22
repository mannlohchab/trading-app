// OpenRouter text-to-speech for the Home daily brief. Secrets stay in env; missing key → no audio.
import { AiProviderError } from '../application/errors';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type TtsResult = { bytes: Buffer; contentType: string; model: string };

/**
 * Speaks brief text via OpenRouter's OpenAI-compatible audio speech endpoint.
 * Docs: https://openrouter.ai/docs — model id is configurable (default openai/gpt-4o-mini-tts).
 */
export class OpenRouterTts {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      voice?: string;
      fetch?: Fetcher;
      timeoutMs?: number;
      baseUrl?: string;
    },
  ) {}

  async speak(text: string, signal?: AbortSignal): Promise<TtsResult> {
    const url = `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/audio/speech`;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
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
          input: text.slice(0, 4000),
          voice: this.options.voice ?? 'alloy',
          response_format: 'mp3',
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'Text-to-speech took too long.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach OpenRouter for audio.', true);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError('AI_AUTH_ERROR', 'OpenRouter rejected the API key for TTS.', false);
      }
      throw new AiProviderError('AI_PROVIDER_ERROR', `OpenRouter TTS failed (${response.status}): ${body.slice(0, 200)}`, response.status >= 500);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new AiProviderError('AI_PROVIDER_ERROR', 'OpenRouter returned empty audio.', true);
    return {
      bytes,
      contentType: response.headers.get('content-type') || 'audio/mpeg',
      model: this.options.model,
    };
  }
}
