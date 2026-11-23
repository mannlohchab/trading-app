// Google Gemini script generation for Morning Decode. API key stays server-side.
import { AiProviderError } from '../application/errors';
import type { BriefScriptLlm } from '../application/brief-script';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class GeminiScriptLlm implements BriefScriptLlm {
  readonly name = 'gemini';

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
    const model = this.options.model;
    const base = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.options.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.user }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
        }),
        signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (timeout.aborted) throw new AiProviderError('AI_TIMEOUT', 'Gemini took too long to write the briefing.', true);
      throw new AiProviderError('AI_PROVIDER_ERROR', 'Could not reach Google Gemini.', true);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError('AI_AUTH_ERROR', 'Gemini rejected the API key.', false);
      }
      throw new AiProviderError('AI_PROVIDER_ERROR', `Gemini failed (${response.status}): ${body.slice(0, 200)}`, response.status >= 500);
    }
    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? '';
    if (!text) throw new AiProviderError('AI_PROVIDER_ERROR', 'Gemini returned an empty briefing script.', true);
    return { text, model };
  }
}
