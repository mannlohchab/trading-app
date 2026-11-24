// Private Firecrawl (self-hosted). Search and scrape only — no extract/LLM call,
// so this client cannot spend a model provider's credits.
import { assertPublicHttpUrl } from '../domain/public-url';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type FirecrawlHit = { url: string; title: string; description: string };
export type FirecrawlPage = { url: string; title: string; markdown: string };

export class FirecrawlClient {
  constructor(private readonly options: {
    baseUrl: string;
    apiKey?: string;
    fetch?: Fetcher;
    timeoutMs?: number;
  }) {}

  async search(query: string, limit: number, signal?: AbortSignal): Promise<FirecrawlHit[]> {
    const json = await this.post('/v2/search', { query, limit, timeout: 15_000 }, signal, this.options.timeoutMs ?? 20_000);
    const data = json.data as { web?: unknown } | unknown[] | undefined;
    const rows = Array.isArray(data) ? data : Array.isArray(data?.web) ? data.web : [];
    return rows.flatMap(row => {
      if (!row || typeof row !== 'object') return [];
      const record = row as { url?: unknown; title?: unknown; description?: unknown };
      if (typeof record.url !== 'string') return [];
      try {
        return [{
          url: assertPublicHttpUrl(record.url),
          title: text(record.title, 180),
          description: text(record.description, 300),
        }];
      } catch {
        return [];
      }
    }).slice(0, limit);
  }

  async scrape(url: string, signal?: AbortSignal): Promise<FirecrawlPage> {
    const pageUrl = assertPublicHttpUrl(url);
    const json = await this.post('/v2/scrape', {
      url: pageUrl,
      formats: ['markdown'],
      onlyMainContent: true,
      blockAds: true,
      timeout: 20_000,
    }, signal, this.options.timeoutMs ?? 25_000);
    const data = (json.data ?? {}) as { markdown?: unknown; metadata?: { title?: unknown; sourceURL?: unknown } };
    const markdown = text(data.markdown, 12_000);
    if (!markdown) throw new Error('The page had no readable text.');
    const source = typeof data.metadata?.sourceURL === 'string' ? data.metadata.sourceURL : pageUrl;
    return {
      url: assertPublicHttpUrl(source),
      title: text(data.metadata?.title, 180),
      markdown,
    };
  }

  private async post(path: string, body: unknown, signal: AbortSignal | undefined, timeoutMs: number): Promise<{ data?: unknown }> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.apiKey && { Authorization: `Bearer ${this.options.apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) throw new Error('Firecrawl took too long.');
      throw new Error('Could not reach the research crawler.');
    }
    const json = await response.json().catch(() => null) as { success?: boolean; data?: unknown; error?: unknown } | null;
    if (!response.ok || json?.success === false) {
      const detail = typeof json?.error === 'string' ? json.error.slice(0, 180) : `HTTP ${response.status}`;
      throw new Error(`Research crawler failed: ${detail}`);
    }
    return json ?? {};
  }
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/\u0000/g, '').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}\n[truncated]`;
}
