// A publisher's own RSS/Atom feed (CoinDesk, Cointelegraph, The Block, Decrypt, CryptoSlate, …).
import { NewsSourceUnavailableError } from '../application/errors';
import type { NewsSource } from '../application/ports';
import type { RawNewsItem } from '../domain/article';
import { SourceGate, type FetchOptions } from './http-fetch';
import { parseFeed } from './xml-feed';

export type RssFeedConfig = { id: string; name: string; url: string; intervalMs: number };

export class RssNewsSource implements NewsSource {
  readonly kind = 'rss' as const;
  readonly id: string;
  readonly name: string;
  readonly intervalMs: number;
  private readonly gate: SourceGate;

  constructor(private readonly feed: RssFeedConfig, options: FetchOptions = {}) {
    this.id = feed.id;
    this.name = feed.name;
    this.intervalMs = feed.intervalMs;
    this.gate = new SourceGate(feed.name, options);
  }

  async fetchLatest(): Promise<RawNewsItem[]> {
    const xml = await this.gate.text(this.feed.url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8');
    if (!/<(rss|feed|rdf:RDF)\b/i.test(xml.slice(0, 2000))) throw new NewsSourceUnavailableError(`${this.name} did not return a feed`);
    // "Cointelegraph by Jane Doe" → "Jane Doe".
    const byline = new RegExp(`^${this.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+by\\s+`, 'i');
    return parseFeed(xml).flatMap(entry => entry.link ? [{
      url: entry.link,
      title: entry.title,
      summary: entry.description,
      imageUrl: entry.imageUrl,
      author: entry.author?.replace(byline, '') ?? null,
      publisher: this.name,
      publishedAt: entry.published ? new Date(entry.published) : null,
      categories: entry.categories,
    }] : []);
  }
}
