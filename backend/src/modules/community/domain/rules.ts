// Community rules: what a post, comment, report and attached image may contain, rate limits, the
// moderation threshold and feed cursors. Plain TypeScript, no I/O.

export const LIMITS = {
  postBody: 5000,
  commentBody: 2000,
  reportDetails: 500,
  /** Decoded image bytes. The app sends at most ~1.35 MB. */
  imageBytes: 1_500_000,
} as const;

export const PAGE = { default: 20, max: 50 } as const;
export const COMMENT_PAGE = { default: 100, max: 200 } as const;

/** Sliding one-hour windows, counted from Postgres. */
export const RATE_LIMITS = { postsPerHour: 10, commentsPerHour: 60 } as const;

/** A post reported by this many different users is hidden until a moderator looks at it. */
export const AUTO_HIDE_REPORTS = 5;

export const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'MISLEADING', 'INAPPROPRIATE', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Labels the app shows, mapped to stored reasons (older app builds send these). */
const REASON_LABELS: Record<string, ReportReason> = {
  spam: 'SPAM',
  harassment: 'HARASSMENT',
  'misleading content': 'MISLEADING',
  misleading: 'MISLEADING',
  'other inappropriate content': 'INAPPROPRIATE',
  inappropriate: 'INAPPROPRIATE',
  other: 'OTHER',
};

/** A reason code ("SPAM") or the app's label ("Misleading content"); anything else is OTHER with the text kept as details. */
export function parseReportReason(input: string): { reason: ReportReason; details: string | null } {
  const text = cleanText(input);
  const code = text.toUpperCase();
  if ((REPORT_REASONS as readonly string[]).includes(code)) return { reason: code as ReportReason, details: null };
  const known = REASON_LABELS[text.toLowerCase()];
  if (known) return { reason: known, details: null };
  return { reason: 'OTHER', details: text.slice(0, LIMITS.reportDetails) || null };
}

/**
 * User-written text: normalized line endings, control characters (other than newline and tab)
 * removed, trailing spaces per line and runs of blank lines collapsed, trimmed.
 */
export function cleanText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type TextCheck = { ok: true; text: string } | { ok: false; message: string };

export function checkBody(input: string, max: number, what: 'Post' | 'Comment'): TextCheck {
  const text = cleanText(input);
  if (!text) return { ok: false, message: `${what} can't be empty.` };
  // Length in code points, matching Postgres char_length.
  if ([...text].length > max) return { ok: false, message: `${what} must be at most ${max} characters.` };
  return { ok: true, text };
}

/** "BTC/USDT", "btc-usdt", "BTC USDT" → "BTCUSDT". Null when it can't be a symbol. */
export function normalizeTicker(input: string): string | null {
  const symbol = input.trim().toUpperCase().replace(/[\s/\-_.:]/g, '');
  return /^[A-Z0-9]{2,30}$/.test(symbol) ? symbol : null;
}

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/** Detects the format from the file's first bytes. The declared type is never trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (bytes.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return 'image/gif';
  return null;
}

export type ImageCheck = { ok: true; contentType: ImageType; bytes: Uint8Array } | { ok: false; message: string };

/** Accepts a base64 data URL (`data:image/png;base64,...`) of a JPEG, PNG, WebP or GIF. SVG is refused. */
export function decodeImageDataUrl(input: string): ImageCheck {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(input.trim());
  if (!match) return { ok: false, message: 'Attach a JPEG, PNG, WebP or GIF image.' };
  const base64 = match[1]!;
  if (Math.floor((base64.length * 3) / 4) > LIMITS.imageBytes + 2) return { ok: false, message: 'Images must be under 1.5 MB.' };
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (!bytes.length) return { ok: false, message: 'The image is empty.' };
  if (bytes.length > LIMITS.imageBytes) return { ok: false, message: 'Images must be under 1.5 MB.' };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, message: 'Attach a JPEG, PNG, WebP or GIF image.' };
  return { ok: true, contentType, bytes };
}

/** Name shown for an author: full name from the profile, then account name, then username. */
export function displayName(a: { firstName: string | null; lastName: string | null; name: string | null; username: string | null }): string {
  const full = [a.firstName, a.lastName].map(s => s?.trim()).filter(Boolean).join(' ');
  return full || a.name?.trim() || a.username || 'Trader';
}

/** Only web links are returned as avatars (profile fields are free text). */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// --- Cursors ----------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opaque keyset cursor: base64url("<µs since epoch>.<id>"). Postgres keeps microseconds, so a
 * millisecond cursor would skip or repeat rows created in the same millisecond.
 */
export const encodeCursor = (c: { atMicros: bigint | string; id: string }) => Buffer.from(`${c.atMicros}.${c.id}`).toString('base64url');

export function decodeCursor(cursor: string): { atMicros: string; id: string } | null {
  const [micros, id] = Buffer.from(cursor, 'base64url').toString().split('.');
  if (!micros || !/^\d{1,18}$/.test(micros) || !id || !UUID.test(id)) return null;
  return { atMicros: micros, id };
}

export const isUuid = (value: string) => UUID.test(value);
