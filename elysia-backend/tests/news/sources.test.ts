import { describe, expect, test } from 'bun:test';
import { NewsSourceUnavailableError } from '../../src/modules/news/application/errors';
import { CryptocurrencyCvSource, isCvArticle } from '../../src/modules/news/infrastructure/cryptocurrency-cv.source';
import { CryptoPanicSource } from '../../src/modules/news/infrastructure/cryptopanic.source';
import { SourceGate, type Fetcher } from '../../src/modules/news/infrastructure/http-fetch';
import { RssNewsSource } from '../../src/modules/news/infrastructure/rss.source';
import { parseFeed } from '../../src/modules/news/infrastructure/xml-feed';

// Shapes copied from the real feeds (CoinDesk, Cointelegraph, Decrypt, CryptoSlate); text is made up.
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title>Feed</title><link>https://example.com</link>
<item>
  <title><![CDATA[A Bitcoin block neared a record]]></title>
  <link>https://www.coindesk.com/tech/2026/11/09/a-bitcoin-block</link>
  <media:content url="https://cdn.example.com/a.jpg?fm=jpg&amp;w=800" type="image/*" medium="image"/>
  <guid isPermaLink="false">48756fa3</guid>
  <pubDate>Mon, 09 Nov 2026 16:19:45 +0000</pubDate>
  <description><![CDATA[Fees made up less than 0.1% &xxe;]]></description>
  <dc:creator>Jane Writer</dc:creator>
  <category domain="https://www.coindesk.com/tech"><![CDATA[Tech]]></category>
  <category domain="tag"><![CDATA[Bitcoin News]]></category>
</item>
<item>
  <title>Nvidia&#39;s scare</title>
  <guid isPermaLink="true">https://cointelegraph.com/news/nvidia-scare</guid>
  <link><![CDATA[https://cointelegraph.com/news/nvidia-scare?utm_source=rss_feed]]></link>
  <description><![CDATA[<p style="float:right"><img src="https://img.example.com/cover.jpg" alt=""></p><p>Shares slid.</p>]]></description>
  <dc:creator>Cointelegraph by Isabelle Castro</dc:creator>
</item>
<item>
  <title>Only a guid link</title>
  <guid>https://decrypt.co/1/only-guid</guid>
  <enclosure url="https://img.decrypt.co/x.png" length="1" type="image/png" />
</item>
<item><title>No link at all</title><guid isPermaLink="false">p=1</guid></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom story</title><link rel="alternate" href="https://blog.example.com/atom-story"/><id>tag:1</id>
<updated>2026-11-09T10:00:00Z</updated><summary>Short &lt;b&gt;text&lt;/b&gt;</summary><author><name>Ann</name></author>
<category term="Ethereum"/></entry></feed>`;

const respond = (body: string, init: ResponseInit = {}): Fetcher => async () => new Response(body, { status: 200, ...init });

describe('feed parsing', () => {
  test('reads RSS items, images, authors and categories; never expands entities from a DTD', () => {
    const entries = parseFeed(RSS);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      title: 'A Bitcoin block neared a record', link: 'https://www.coindesk.com/tech/2026/11/09/a-bitcoin-block',
      imageUrl: 'https://cdn.example.com/a.jpg?fm=jpg&amp;w=800', author: 'Jane Writer', categories: ['Tech', 'Bitcoin News'],
      published: 'Mon, 09 Nov 2026 16:19:45 +0000',
    });
    expect(entries[0]!.description).not.toContain('root:');
    expect(entries[1]).toMatchObject({ link: 'https://cointelegraph.com/news/nvidia-scare?utm_source=rss_feed', imageUrl: 'https://img.example.com/cover.jpg' });
    expect(entries[2]).toMatchObject({ link: 'https://decrypt.co/1/only-guid', imageUrl: 'https://img.decrypt.co/x.png' });
    expect(entries[3]!.link).toBeNull();
  });

  test('reads Atom entries', () => {
    expect(parseFeed(ATOM)).toEqual([{
      title: 'Atom story', link: 'https://blog.example.com/atom-story', guid: 'tag:1', published: '2026-11-09T10:00:00Z',
      description: 'Short &lt;b&gt;text&lt;/b&gt;', author: 'Ann', categories: ['Ethereum'], imageUrl: null,
    }]);
  });

  test('RSS source maps entries, skips linkless ones and strips "<Publisher> by" bylines', async () => {
    const source = new RssNewsSource({ id: 'cointelegraph', name: 'Cointelegraph', url: 'https://feed', intervalMs: 1 }, { fetch: respond(RSS) });
    const items = await source.fetchLatest();
    expect(items.map(i => i.title)).toEqual(['A Bitcoin block neared a record', 'Nvidia&#39;s scare', 'Only a guid link']);
    expect(items[1]!.author).toBe('Isabelle Castro');
    expect(items[0]!.publishedAt).toEqual(new Date('2026-11-09T16:19:45Z'));
  });

  test('an HTML page is not a feed', async () => {
    const source = new RssNewsSource({ id: 'x', name: 'X', url: 'https://feed', intervalMs: 1 }, { fetch: respond('<!DOCTYPE html><html>Attention Required</html>') });
    await expect(source.fetchLatest()).rejects.toThrow('did not return a feed');
  });
});

describe('Free Crypto News API', () => {
  const article = (over: Record<string, unknown>) => ({
    title: 'Story', link: 'https://theblock.co/a', description: 'About Bitcoin', pubDate: '2026-11-09T18:30:22.000Z', source: 'The Block',
    sourceKey: 'theblock', category: 'general', contentType: 'news', credibility: 0.93, ...over,
  });

  test('keeps articles, drops data rows and non-crypto mainstream stories', () => {
    expect(isCvArticle(article({}))).toBe(true);
    expect(isCvArticle(article({ contentType: 'analysis' }))).toBe(true);
    expect(isCvArticle(article({ contentType: undefined, title: '⛽ ETH Gas: 0.13 Gwei' }))).toBe(false);
    expect(isCvArticle(article({ category: 'mainstream', title: 'Facial recognition stops shoplifters', description: 'Retail tech' }))).toBe(false);
    expect(isCvArticle(article({ category: 'mainstream', title: 'Prediction markets on election night', description: 'Crypto bets surged' }))).toBe(true);
  });

  test('polls breaking, latest and each topic; marks breaking items; tolerates partial failure', async () => {
    const calls: string[] = [];
    const fetch: Fetcher = async url => {
      calls.push(url);
      if (url.includes('/api/search?q=ethereum')) return new Response('oops', { status: 500 });
      const path = new URL(url).pathname + new URL(url).search;
      return Response.json({ articles: [article({ link: `https://theblock.co${path.replace(/\W/g, '-')}` })] });
    };
    const source = new CryptocurrencyCvSource({ baseUrl: 'https://cv.test/', intervalMs: 1, topics: ['bitcoin', 'ethereum'] }, { fetch });
    const items = await source.fetchLatest();
    expect(calls).toEqual(['https://cv.test/api/breaking', 'https://cv.test/api/news', 'https://cv.test/api/search?q=bitcoin', 'https://cv.test/api/search?q=ethereum']);
    expect(items).toHaveLength(3);
    expect(items.map(i => i.breaking)).toEqual([true, false, false]);
    expect(items[0]).toMatchObject({ publisher: 'The Block', categories: ['general'], metadata: { sourceKey: 'theblock', credibility: 0.93 } });
  });

  test('fails only when every request failed', async () => {
    const source = new CryptocurrencyCvSource({ baseUrl: 'https://cv.test', intervalMs: 1, topics: [] }, { fetch: respond('{"nope":1}') });
    await expect(source.fetchLatest()).rejects.toThrow('unexpected response');
  });
});

describe('CryptoPanic', () => {
  test('maps posts (v1 or v2 field names) and keeps the key out of errors', async () => {
    let requested = '';
    const fetch: Fetcher = async url => {
      requested = url;
      return Response.json({ results: [
        { id: 1, slug: 'btc-up', title: 'BTC up', published_at: '2026-11-09T10:00:00Z', kind: 'news', source: { title: 'Decrypt' }, original_url: 'https://decrypt.co/1', instruments: [{ code: 'BTC' }], votes: { positive: 3 } },
        { id: 2, slug: 'eth-news', title: 'ETH news', created_at: '2026-11-09T09:00:00Z', currencies: [{ code: 'ETH' }] },
        { id: 3, title: 'Media post', kind: 'media', url: 'https://youtube.com/x' },
        { title: '' },
      ] });
    };
    const source = new CryptoPanicSource({ apiKey: 'secret-key', baseUrl: 'https://cp.test/api/developer/v2', intervalMs: 1 }, { fetch });
    const items = await source.fetchLatest();
    expect(new URL(requested).searchParams.get('auth_token')).toBe('secret-key');
    expect(items).toEqual([
      expect.objectContaining({ url: 'https://decrypt.co/1', publisher: 'Decrypt', assets: ['BTC'], metadata: { votes: { positive: 3 } } }),
      expect.objectContaining({ url: 'https://cryptopanic.com/news/2/eth-news', publisher: 'CryptoPanic', assets: ['ETH'], publishedAt: new Date('2026-11-09T09:00:00Z') }),
    ]);

    const failing = new CryptoPanicSource({ apiKey: 'secret-key', intervalMs: 1 }, {
      fetch: async url => { throw new Error(`connect ECONNREFUSED while fetching ${url}`); },
    });
    const error = (await failing.fetchLatest().catch(e => e)) as Error;
    expect(error).toBeInstanceOf(NewsSourceUnavailableError);
    expect(error.message).not.toContain('secret-key');
  });
});

describe('source gate', () => {
  test('429 starts a cooldown from Retry-After; no request is made during it', async () => {
    let now = 1_000_000;
    let calls = 0;
    const gate = new SourceGate('Src', { now: () => now, fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); } });
    const first = (await gate.text('https://x', '*/*').catch(e => e)) as NewsSourceUnavailableError;
    expect(first.retryAfterMs).toBe(120_000);
    const second = (await gate.text('https://x', '*/*').catch(e => e)) as NewsSourceUnavailableError;
    expect(second.message).toContain('cooldown');
    expect(calls).toBe(1);
    now += 121_000;
    await gate.text('https://x', '*/*').catch(() => {});
    expect(calls).toBe(2);
  });

  test('bodies over the size cap are rejected while streaming', async () => {
    const big = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); } });
    const gate = new SourceGate('Src', { maxBytes: 4096, fetch: async () => new Response(big) });
    await expect(gate.text('https://x', '*/*')).rejects.toThrow('larger than 4096 bytes');
  });

  test('HTTP errors become NewsSourceUnavailableError', async () => {
    const gate = new SourceGate('Src', { fetch: respond('nope', { status: 403 }) });
    await expect(gate.text('https://x', '*/*')).rejects.toThrow('Src answered 403');
  });
});
