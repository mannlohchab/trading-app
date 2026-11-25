// Long-term memory rules. Pure. A memory is one short fact the user told the assistant about
// themselves and their trading; users can list and delete every one of them in the app.

export const MEMORY_LIMITS = { perUser: 30, contentMax: 300, writesPerTurn: 2 } as const;

export type Memory = { id: string; content: string; createdAt: Date };

/** Things that must never be stored, even if the user typed them. */
const SENSITIVE: { pattern: RegExp; reason: string }[] = [
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, reason: 'an email address' },
  { pattern: /(?:\+?\d[\s-]?){10,}/, reason: 'a phone, card or account number' },
  { pattern: /\b(?:password|passcode|otp|one[- ]time code|pin|cvv|api[ _-]?key|secret|seed phrase|recovery phrase|private key)\b/i, reason: 'a credential' },
  { pattern: /\b(?:aadhaar|pan card|passport|ssn|social security)\b/i, reason: 'an identity document' },
];

export type MemoryCheck = { ok: true; content: string } | { ok: false; error: string };

export function checkMemory(raw: string): MemoryCheck {
  const content = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!content) return { ok: false, error: 'The fact is empty.' };
  if (content.length > MEMORY_LIMITS.contentMax) return { ok: false, error: `Keep a memory under ${MEMORY_LIMITS.contentMax} characters.` };
  const hit = SENSITIVE.find(s => s.pattern.test(content));
  if (hit) return { ok: false, error: `Not saved: it looks like ${hit.reason}. Never store contact details, account numbers, credentials or identity documents.` };
  return { ok: true, content };
}

/** Same fact, ignoring case, punctuation and spacing. */
export const sameMemory = (a: string, b: string) => {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return key(a) === key(b);
};
