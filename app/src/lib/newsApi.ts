// Crypto news from the backend (`/api/v1/news`). The backend polls the sources and serves stored
// articles, so the app never calls a news site directly. The demo preview gets fictional samples.
import { api } from './api';

export type NewsArticle = {
  id: string;
  title: string;
  summary: string | null;
  /** Always http(s); null for demo samples, which have nowhere to open. */
  url: string | null;
  imageUrl: string | null;
  author: string | null;
  publisher: { key: string; name: string };
  publishedAt: string;
  /** Coin codes the story is about, e.g. ["BTC"]. */
  assets: string[];
  breaking: boolean;
};

export type NewsPage = { articles: NewsArticle[]; nextCursor: string | null };

/** Newest first. `asset` filters by coin (e.g. "BTC"); pass the previous page's `nextCursor` for more. */
export function fetchNews(options: { limit?: number; cursor?: string | null; asset?: string; signal?: AbortSignal } = {}): Promise<NewsPage> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.asset) params.set('asset', options.asset);
  return api<NewsPage>(`/api/v1/news?${params}`, { signal: options.signal });
}

/** Only web links are opened (the backend stores nothing else, this is a second check). */
export const isOpenable = (article: Pick<NewsArticle, 'url'>): article is { url: string } =>
  typeof article.url === 'string' && /^https?:\/\//i.test(article.url);
