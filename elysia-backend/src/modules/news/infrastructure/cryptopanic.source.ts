// CryptoPanic (https://cryptopanic.com/developers/api/): news tagged by coin with community votes.
// Needs an API key (CRYPTOPANIC_API_KEY); free plans are small, so the default poll is hourly.
// The key travels in the query string, so URLs are never logged or put into errors.
import { NewsSourceUnavailableError } from '../application/errors';
import type { NewsSource } from '../application/ports';
import type { RawNewsItem } from '../domain/article';
import { SourceGate, type FetchOptions } from './http-fetch';

type Post = {
  id?: unknown; slug?: unknown; title?: unknown; description?: unknown; published_at?: unknown; created_at?: unknown; kind?: unknown;
  url?: unknown; original_url?: unknown; image?: unknown;
  source?: { title?: unknown; domain?: unknown } | null;
  // v1 calls the coins `currencies`, v2 `instruments`.
  currencies?: { code?: unknown }[] | null; instruments?: { code?: unknown }[] | null;
  votes?: Record<string, unknown> | null; panic_score?: unknown;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

export class CryptoPanicSource implements NewsSource {
  readonly id = 'cryptopanic';
  readonly name = 'CryptoPanic';
  readonly kind = 'aggregator' as const;
  private readonly gate: SourceGate;

  constructor(private readonly config: { apiKey: string; baseUrl?: string; intervalMs: number }, options: FetchOptions = {}) {
    this.gate = new SourceGate(this.name, options);
  }

  get intervalMs() { return this.config.intervalMs; }

  async fetchLatest(): Promise<RawNewsItem[]> {
    const base = (this.config.baseUrl ?? 'https://cryptopanic.com/api/developer/v2').replace(/\/+$/, '');
    const query = new URLSearchParams({ auth_token: this.config.apiKey, public: 'true', kind: 'news' });
    const body = await this.gate.json<{ results?: unknown }>(`${base}/posts/?${query}`);
    if (!Array.isArray(body?.results)) throw new NewsSourceUnavailableError(`${this.name} returned an unexpected response`);
    return (body.results as Post[]).flatMap((p): RawNewsItem[] => {
      if (!p || typeof p !== 'object' || (p.kind && p.kind !== 'news')) return [];
      const title = str(p.title);
      const fallback = (typeof p.id === 'number' || typeof p.id === 'string') && str(p.slug) ? `https://cryptopanic.com/news/${p.id}/${p.slug}` : null;
      const url = str(p.original_url) ?? str(p.url) ?? fallback;
      if (!title || !url) return [];
      const coins = [...(p.instruments ?? []), ...(p.currencies ?? [])].map(c => str(c?.code)).filter((c): c is string => !!c);
      return [{
        url, title,
        summary: str(p.description),
        imageUrl: str(p.image),
        publisher: str(p.source?.title) ?? str(p.source?.domain) ?? this.name,
        publishedAt: str(p.published_at) ? new Date(p.published_at as string) : str(p.created_at) ? new Date(p.created_at as string) : null,
        assets: coins,
        metadata: { ...(p.votes && { votes: p.votes }), ...(typeof p.panic_score === 'number' && { panicScore: p.panic_score }) },
      }];
    });
  }
}
