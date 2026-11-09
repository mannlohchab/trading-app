// Free Crypto News API (https://cryptocurrency.cv): a free, key-less aggregator of 300+ outlets.
// Free tier: 120 requests/hour, /api/news returns only 3 items, /api/breaking and /api/search 10 each.
// One poll = breaking + latest + one search per topic, so the default (10 min, 4 topics) uses 36/hour.
import { NewsSourceUnavailableError } from '../application/errors';
import type { NewsSource } from '../application/ports';
import { mentionsCrypto, type RawNewsItem } from '../domain/article';
import { SourceGate, type FetchOptions } from './http-fetch';

type CvArticle = {
  title?: unknown; link?: unknown; description?: unknown; imageUrl?: unknown; pubDate?: unknown; source?: unknown;
  sourceKey?: unknown; category?: unknown; contentType?: unknown; author?: unknown; credibility?: unknown;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

// Its general business categories also carry non-crypto stories (e.g. BBC Business): keep those only when they are about crypto.
const GENERAL_MARKET = new Set(['mainstream', 'tradfi', 'macro', 'geopolitical']);
// Items without one of these content types are data rows ("ETH Gas: …", "Bitcoin Network: … hashrate"), not articles.
const ARTICLE_TYPES = new Set(['news', 'analysis']);

export function isCvArticle(a: CvArticle): boolean {
  if (!ARTICLE_TYPES.has(String(a.contentType ?? ''))) return false;
  if (!GENERAL_MARKET.has(String(a.category ?? ''))) return true;
  return mentionsCrypto(`${a.title ?? ''} ${a.description ?? ''}`);
}

export class CryptocurrencyCvSource implements NewsSource {
  readonly id = 'cryptocurrency-cv';
  readonly name = 'Free Crypto News API';
  readonly kind = 'aggregator' as const;
  private readonly gate: SourceGate;

  constructor(private readonly config: { baseUrl?: string; intervalMs: number; topics: string[] }, options: FetchOptions = {}) {
    this.gate = new SourceGate(this.name, options);
  }

  get intervalMs() { return this.config.intervalMs; }

  async fetchLatest(): Promise<RawNewsItem[]> {
    const base = (this.config.baseUrl ?? 'https://cryptocurrency.cv').replace(/\/+$/, '');
    const requests: { path: string; breaking: boolean }[] = [
      { path: '/api/breaking', breaking: true },
      { path: '/api/news', breaking: false },
      ...this.config.topics.map(topic => ({ path: `/api/search?${new URLSearchParams({ q: topic })}`, breaking: false })),
    ];
    // Sequential: the API is rate limited per client, and a cooldown after a 429 then skips the rest.
    const items: RawNewsItem[] = [];
    let firstError: unknown;
    let succeeded = 0;
    for (const request of requests) {
      try {
        const body = await this.gate.json<{ articles?: unknown }>(`${base}${request.path}`);
        if (!Array.isArray(body?.articles)) throw new NewsSourceUnavailableError(`${this.name} returned an unexpected response`);
        succeeded++;
        for (const a of body.articles as CvArticle[]) {
          if (!a || typeof a !== 'object' || !isCvArticle(a)) continue;
          const url = str(a.link);
          const title = str(a.title);
          if (!url || !title) continue;
          items.push({
            url, title,
            summary: str(a.description),
            imageUrl: str(a.imageUrl),
            author: str(a.author),
            publisher: str(a.source) ?? this.name,
            publishedAt: str(a.pubDate) ? new Date(a.pubDate as string) : null,
            categories: str(a.category) ? [a.category as string] : [],
            breaking: request.breaking,
            metadata: { sourceKey: str(a.sourceKey), category: str(a.category), ...(typeof a.credibility === 'number' && { credibility: a.credibility }) },
          });
        }
      } catch (error) {
        firstError ??= error;
      }
    }
    // Partial results are still worth storing; only a poll where nothing worked counts as a failure.
    if (!succeeded) throw firstError instanceof Error ? firstError : new NewsSourceUnavailableError(`${this.name} unavailable`);
    return items;
  }
}
