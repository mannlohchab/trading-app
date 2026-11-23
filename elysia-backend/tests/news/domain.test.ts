import { describe, expect, test } from 'bun:test';
import {
  canonicalUrl, decodeEntities, mentionsCrypto, nextPollDelayMs, normalizeBatch, normalizeItem, plainText, publisherKey, safeUrl, summarize,
} from '../../src/modules/news/domain/article';
import { detectAssets } from '../../src/modules/news/domain/assets';

const now = new Date('2026-11-10T12:00:00Z');

describe('text cleaning', () => {
  test('decodes named and numeric entities exactly once', () => {
    expect(decodeEntities('Nvidia&#39;s &amp; AMD&#x2019;s &hellip; &amp;lt;')).toBe('Nvidia\'s & AMD’s … &lt;');
    expect(decodeEntities('&#0; &#xD800; &bogus;')).toBe('&#0; &#xD800; &bogus;');
  });

  test('strips tags, scripts and styles', () => {
    expect(plainText('<p>Hi <b>there</b></p><script>alert(1)</script><style>p{}</style>')).toBe('Hi there');
  });

  test('summaries use the first paragraph with text (feeds append promos)', () => {
    const cointelegraph = '<p style="float:right"><img src="https://x/y.jpg"></p><p>Customers can view balances.</p>';
    const cryptoslate = '<p>Ueda’s lecture separates earnings.</p> <p><a href="#">Read the full story on CryptoSlate</a></p>';
    expect(summarize(cointelegraph)).toBe('Customers can view balances.');
    expect(summarize(cryptoslate)).toBe('Ueda’s lecture separates earnings.');
    expect(summarize('Plain text summary')).toBe('Plain text summary');
    expect(summarize('')).toBeNull();
    expect(summarize('x '.repeat(1000))!.length).toBeLessThanOrEqual(600);
  });
});

describe('urls', () => {
  test('only http(s) links without credentials are kept', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('https://user:pw@example.com/a')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('https://example.com/a?x=1&amp;y=2')).toBe('https://example.com/a?x=1&y=2');
  });

  test('canonical form ignores www, tracking parameters, fragments, trailing slashes and scheme', () => {
    const a = canonicalUrl('https://cointelegraph.com/news/mercado-bitcoin?utm_source=rss_feed&utm_medium=rss#top');
    const b = canonicalUrl('http://www.Cointelegraph.com/news/mercado-bitcoin/');
    expect(a).toBe('https://cointelegraph.com/news/mercado-bitcoin');
    expect(b).toBe(a);
    // Meaningful parameters stay (sorted), so different articles don't collapse.
    expect(canonicalUrl('https://x.com/a?id=2&at_medium=RSS&b=1')).toBe('https://x.com/a?b=1&id=2');
  });

  test('publisher keys are compact slugs', () => {
    expect(publisherKey('The Block')).toBe('theblock');
    expect(publisherKey('CNBC Crypto')).toBe('cnbccrypto');
    expect(publisherKey('***')).toBe('unknown');
  });
});

describe('coin detection', () => {
  test('finds coins by name and by capitalised ticker', () => {
    expect(detectAssets('Avalanche’s AVAX leads crypto gains')).toEqual(['AVAX']);
    expect(detectAssets('Bitmine Buys $20M in ETH as Tom Lee hails Bitcoin')).toEqual(['BTC', 'ETH']);
    expect(detectAssets('TradeCityPro | Solana (SOL): $65 breakdown')).toEqual(['SOL']);
    expect(detectAssets('Marathon sells 15,133 $BTC')).toEqual(['BTC']);
  });

  test('avoids ordinary words and trading pairs', () => {
    expect(detectAssets('Investors show optimism; one link to the dot-com era')).toEqual([]);
    expect(detectAssets('BTCUSDT breaks out')).toEqual([]);
    expect(detectAssets('sol is sun in Spanish')).toEqual([]);
  });

  test('Bitcoin Cash is not Bitcoin', () => {
    expect(detectAssets('Bitcoin Cash rallies')).toEqual(['BCH']);
    expect(detectAssets('Bitcoin Cash and Bitcoin rally')).toEqual(['BCH', 'BTC']);
  });

  test('categories can name coins', () => {
    expect(detectAssets('Market update', ['bitcoin', 'btc', 'analysis'])).toEqual(['BTC']);
  });

  test('crypto relevance for general-market stories', () => {
    expect(mentionsCrypto('Prediction markets surge as stablecoin volumes climb')).toBe(true);
    expect(mentionsCrypto('The facial recognition technology stopping shoplifters')).toBe(false);
    expect(mentionsCrypto('Gold mining stocks and ETF flows')).toBe(false);
  });
});

describe('normalizing items', () => {
  const base = { url: 'https://coindesk.com/a?utm_source=x', title: '<b>Bitcoin</b> &amp; ETH', publisher: 'CoinDesk' };

  test('cleans fields and tags coins', () => {
    const draft = normalizeItem({ ...base, summary: '<p>Fees hit lows.</p>', categories: ['Tech', 'tech', ' Bitcoin News '], breaking: true, metadata: { score: 1 } }, 'coindesk', now)!;
    expect(draft).toMatchObject({
      canonicalUrl: 'https://coindesk.com/a', title: 'Bitcoin & ETH', summary: 'Fees hit lows.', publisherKey: 'coindesk',
      categories: ['tech', 'bitcoin news'], assets: ['BTC', 'ETH'], providers: ['coindesk'], breakingAt: now, metadata: { coindesk: { score: 1 } },
    });
  });

  test('drops unsafe links and empty titles', () => {
    expect(normalizeItem({ ...base, url: 'javascript:void(0)' }, 'x', now)).toBeNull();
    expect(normalizeItem({ ...base, title: '<br>' }, 'x', now)).toBeNull();
  });

  test('missing, invalid or future dates become now', () => {
    expect(normalizeItem({ ...base, publishedAt: null }, 'x', now)!.publishedAt).toEqual(now);
    expect(normalizeItem({ ...base, publishedAt: new Date('nope') }, 'x', now)!.publishedAt).toEqual(now);
    expect(normalizeItem({ ...base, publishedAt: new Date('2030-01-01') }, 'x', now)!.publishedAt).toEqual(now);
    const past = new Date('2026-11-09T00:00:00Z');
    expect(normalizeItem({ ...base, publishedAt: past }, 'x', now)!.publishedAt).toEqual(past);
  });

  test('duplicates within one batch merge', () => {
    const batch = normalizeBatch([{ ...base }, { ...base, url: 'https://www.coindesk.com/a/', title: 'Solana news', breaking: true }], 'x', now);
    expect(batch).toHaveLength(1);
    expect(batch[0]!.breakingAt).toEqual(now);
  });
});

test('poll back-off doubles up to 8× and honours Retry-After', () => {
  const interval = 10 * 60_000;
  expect([0, 1, 2, 3, 4, 9].map(f => nextPollDelayMs(interval, f) / interval)).toEqual([1, 1, 2, 4, 8, 8]);
  expect(nextPollDelayMs(interval, 1, 3 * interval)).toBe(3 * interval);
});
