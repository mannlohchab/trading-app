// Minimal RSS 2.0 / Atom reader for news feeds. Feeds are untrusted input: no DTDs or external
// entities are processed, only the handful of elements a news item needs are read, and the item
// count is capped.

export type FeedEntry = {
  title: string;
  link: string | null;
  guid: string | null;
  published: string | null;
  /** Raw description/summary/content (HTML). */
  description: string | null;
  author: string | null;
  categories: string[];
  imageUrl: string | null;
};

const MAX_ENTRIES = 200;

const unwrapCdata = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** Text content of the first matching element, with CDATA unwrapped. Entities are left for the caller. */
function element(block: string, names: string[]): string | null {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i'));
    if (match) {
      const value = unwrapCdata(match[1]!).trim();
      if (value) return value;
    }
  }
  return null;
}

function elements(block: string, name: string): string[] {
  return [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'gi'))].map(m => unwrapCdata(m[1]!).trim()).filter(Boolean);
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[2] ?? match[3] ?? null) : null;
}

/** Opening (or self-closing) tags named `name`, e.g. all `<media:content …>` tags. */
const tags = (block: string, name: string) => block.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];

function image(block: string, description: string | null): string | null {
  for (const name of ['media:content', 'media:thumbnail']) {
    for (const tag of tags(block, name)) {
      const medium = attribute(tag, 'medium');
      const type = attribute(tag, 'type');
      if ((!medium || medium === 'image') && (!type || type.startsWith('image'))) {
        const url = attribute(tag, 'url');
        if (url) return url;
      }
    }
  }
  for (const tag of tags(block, 'enclosure')) {
    if ((attribute(tag, 'type') ?? '').startsWith('image')) return attribute(tag, 'url');
  }
  // Some feeds only put the picture inside the description HTML.
  const img = description?.match(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  return img?.[1] ?? null;
}

function atomLink(block: string): string | null {
  const links = tags(block, 'link');
  const alternate = links.find(t => (attribute(t, 'rel') ?? 'alternate') === 'alternate') ?? links[0];
  return alternate ? attribute(alternate, 'href') : null;
}

export function parseFeed(xml: string): FeedEntry[] {
  // Never expand DTDs: drop any DOCTYPE (and its internal subset) before reading.
  const body = xml.replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/i, '');
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(body) && !/<item[\s>]/i.test(body);
  const blocks = isAtom
    ? [...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)]
    : [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)];
  return blocks.slice(0, MAX_ENTRIES).map(([, block]) => {
    const description = element(block!, isAtom ? ['summary', 'content'] : ['description', 'content:encoded', 'summary']);
    const rssLink = isAtom ? null : element(block!, ['link']);
    const guid = element(block!, isAtom ? ['id'] : ['guid']);
    const guidTag = tags(block!, 'guid')[0];
    // RSS <guid> is a link unless isPermaLink="false".
    const guidLink = !isAtom && guid && guidTag && attribute(guidTag, 'isPermaLink') !== 'false' && /^https?:\/\//.test(guid) ? guid : null;
    return {
      title: element(block!, ['title']) ?? '',
      link: (isAtom ? atomLink(block!) : rssLink) ?? guidLink,
      guid,
      published: element(block!, isAtom ? ['published', 'updated'] : ['pubDate', 'dc:date', 'published', 'updated']),
      description,
      // Atom wraps the author: <author><name>…</name></author>.
      author: isAtom ? element(element(block!, ['author']) ?? '', ['name']) : element(block!, ['dc:creator', 'author']),
      categories: isAtom ? tags(block!, 'category').map(t => attribute(t, 'term') ?? '').filter(Boolean) : elements(block!, 'category'),
      imageUrl: image(block!, description),
    };
  });
}
