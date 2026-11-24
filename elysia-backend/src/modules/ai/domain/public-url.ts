// URLs the research agent is allowed to ask Firecrawl to read.
// Blocks loopback, private, link-local, and single-label names (Docker service DNS).

const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa', '.lan', '.localdomain'];

export function assertPublicHttpUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('That URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only public http and https pages can be read.');
  if (url.username || url.password) throw new Error('URLs with credentials cannot be read.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) throw new Error('That URL has no host.');
  if (host === 'localhost' || host === 'metadata.google.internal' || host === 'metadata.google.com') {
    throw new Error('That host is not a public web page.');
  }
  if (BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix))) throw new Error('That host is not a public web page.');
  if (!host.includes('.') && !host.includes(':')) throw new Error('That host is not a public web page.');
  if (/^\d+$/.test(host)) throw new Error('That host is not a public web page.');
  if (isBlockedAddress(host)) throw new Error('That host is not a public web page.');
  return url.href;
}

function isBlockedAddress(host: string): boolean {
  const v4 = parseIpv4(host);
  if (v4) return isPrivateV4(v4);
  if (/^\d{1,3}(?:\.\d{1,3}){0,2}$/.test(host)) return true;
  if (!host.includes(':')) return false;
  return isBlockedV6(host.toLowerCase());
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(part => (/^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : NaN));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateV4(parts: number[]): boolean {
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedV6(host: string): boolean {
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (/^ff[0-9a-f]{2}:/.test(host)) return true;
  if (host.startsWith('2001:db8:')) return true;
  if (host.startsWith('::ffff:')) {
    const mapped = parseIpv4(host.slice('::ffff:'.length));
    return !mapped || isPrivateV4(mapped);
  }
  return false;
}
