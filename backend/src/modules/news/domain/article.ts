// Crypto news articles: what sources deliver (`RawNewsItem`), how it is normalized into a stored
// article, and the rules for de-duplication, relevance and scheduling. Plain TypeScript, no I/O.
import { detectAssets } from './assets';

/** One item as a source adapter delivers it: text may still contain HTML and entities. */
export type RawNewsItem = {
  url: string;
  title: string;
  /** HTML or plain text. */
  summary?: string | null;
  imageUrl?: string | null;
  author?: string | null;
  /** Outlet that published it, e.g. "CoinDesk". */
  publisher: string;
  publishedAt?: Date | null;
  categories?: string[];
  /** Coin codes the source itself tagged (e.g. CryptoPanic currencies). */
  assets?: string[];
  breaking?: boolean;
  metadata?: Record<string, unknown>;
};

/** A normalized article ready to store. `providers` lists the source ids that delivered it. */
export type NewsArticleDraft = {
  canonicalUrl: string;
  url: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  author: string | null;
  publisher: string;
  publisherKey: string;
  publishedAt: Date;
  categories: string[];
  assets: string[];
  providers: string[];
  /** When a source first flagged the story as breaking (this poll's time), or null. */
  breakingAt: Date | null;
  /** Provider-specific extras, keyed by provider id so repeats from different sources merge. */
  metadata: Record<string, unknown>;
};

export type NewsArticle = Omit<NewsArticleDraft, 'canonicalUrl' | 'metadata'> & {
  id: string;
  firstSeenAt: Date;
};

export const LIMITS = { title: 500, summary: 600, author: 200, publisher: 100, url: 2048, categories: 10, category: 60 } as const;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
};

/** Decodes HTML/XML character references. Applied once, so "&amp;lt;" becomes the text "&lt;". */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

const collapse = (text: string) => text.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

/** Plain text from an HTML fragment: tags and scripts removed, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  const withoutCode = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  return collapse(decodeEntities(withoutCode.replace(/<[^>]*>/g, ' ')));
}

/**
 * Short summary from a feed description. Feeds often append "Read more"/newsletter paragraphs, so
 * when the description has paragraphs the first one with text is used.
 */
export function summarize(description: string | null | undefined): string | null {
  if (!description) return null;
  const paragraphs = [...description.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(m => plainText(m[1]!)).filter(Boolean);
  const text = paragraphs[0] ?? plainText(description);
  return text ? truncate(text, LIMITS.summary) : null;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Only http(s) URLs are stored, so the app never renders a `javascript:` or `data:` link. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(decodeEntities(value.trim()));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    const href = url.toString();
    return href.length <= LIMITS.url ? href : null;
  } catch {
    return null;
  }
}

const TRACKING_PARAM = /^(utm_|mc_|at_|fbclid$|gclid$|ref$|ref_src$|cmpid$|ocid$|guccounter$)/i;

/**
 * Identity of an article across sources: the same story from an aggregator and from the publisher's
 * own feed maps to one row. Lower-cased host without "www.", no tracking parameters, fragment or
 * trailing slash, https.
 */
export function canonicalUrl(href: string): string {
  const url = new URL(href);
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.port = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  return `${url.protocol}//${url.hostname}${path}${url.search}`;
}

/** Stable filter key for a publisher name: "The Block" → "theblock". */
export const publisherKey = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 50) || 'unknown';

// Words that only appear in crypto stories. Generic finance words ("exchange", "mining", "ETF") are left
// out on purpose: they also describe stock markets and gold.
const CRYPTO_TERMS = /\b(crypto\w*|bitcoin|ethereum|blockchain|stablecoins?|tokeni[sz]\w*|defi|web3|nfts?|altcoins?|memecoins?|on-?chain|binance|coinbase|tether|satoshi|halving)\b/i;

/** Whether text from a general-market source is about crypto (the aggregator mixes in mainstream business news). */
export const mentionsCrypto = (text: string) => CRYPTO_TERMS.test(text) || detectAssets(text).length > 0;

/**
 * Normalizes one raw item. Returns null for items that can't be stored safely or usefully
 * (no http(s) link, no title).
 */
export function normalizeItem(item: RawNewsItem, providerId: string, now: Date): NewsArticleDraft | null {
  const url = safeUrl(item.url);
  const title = truncate(plainText(item.title ?? ''), LIMITS.title);
  if (!url || !title) return null;
  const summary = summarize(item.summary);
  const publisher = truncate(plainText(item.publisher || new URL(url).hostname), LIMITS.publisher);
  const categories = [...new Set((item.categories ?? []).map(c => plainText(c).toLowerCase()).filter(c => c && c.length <= LIMITS.category))]
    .slice(0, LIMITS.categories);
  const tagged = (item.assets ?? []).map(a => a.trim().toUpperCase()).filter(a => /^[A-Z0-9]{2,10}$/.test(a));
  // Feeds sometimes date items in the future (time-zone mistakes): never store a date ahead of now.
  const published = item.publishedAt && !Number.isNaN(item.publishedAt.getTime()) ? item.publishedAt : now;
  return {
    canonicalUrl: canonicalUrl(url),
    url,
    title,
    summary,
    imageUrl: safeUrl(item.imageUrl),
    author: item.author ? truncate(plainText(item.author), LIMITS.author) || null : null,
    publisher,
    publisherKey: publisherKey(publisher),
    publishedAt: published > now ? now : published,
    categories,
    assets: [...new Set([...tagged, ...detectAssets(`${title} ${summary ?? ''}`, categories)])].sort(),
    providers: [providerId],
    breakingAt: item.breaking === true ? now : null,
    metadata: item.metadata && Object.keys(item.metadata).length ? { [providerId]: item.metadata } : {},
  };
}

/** Normalizes a batch and merges duplicates inside it (a feed can list one story twice). */
export function normalizeBatch(items: RawNewsItem[], providerId: string, now: Date): NewsArticleDraft[] {
  const byUrl = new Map<string, NewsArticleDraft>();
  for (const item of items) {
    const draft = normalizeItem(item, providerId, now);
    if (!draft) continue;
    const existing = byUrl.get(draft.canonicalUrl);
    byUrl.set(draft.canonicalUrl, existing
      ? { ...existing, breakingAt: existing.breakingAt ?? draft.breakingAt, assets: [...new Set([...existing.assets, ...draft.assets])].sort() }
      : draft);
  }
  return [...byUrl.values()];
}

/**
 * Delay until a source is polled again: its interval after a success; after failures, doubling up
 * to 8× the interval, or the source's own Retry-After when it asked for longer.
 */
export function nextPollDelayMs(intervalMs: number, consecutiveFailures: number, retryAfterMs?: number): number {
  const backoff = consecutiveFailures > 0 ? intervalMs * 2 ** Math.min(consecutiveFailures - 1, 3) : intervalMs;
  return Math.max(backoff, retryAfterMs ?? 0);
}

export type SourceHealth = 'pending' | 'ok' | 'failing';

export const sourceHealth = (s: { lastSuccessAt: Date | null; consecutiveFailures: number }): SourceHealth =>
  s.consecutiveFailures > 0 ? 'failing' : s.lastSuccessAt ? 'ok' : 'pending';
