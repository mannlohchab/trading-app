// Field-level validation shared by profile and preference rules. Pure; uses only the JS standard library.

export type FieldErrors = Record<string, string>;
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export function isValidTimeZone(value: string): boolean {
  if (value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** BCP 47 language tag, e.g. "en", "hi", "en-IN". Returned in canonical form. */
export function canonicalLanguage(value: string): string | null {
  if (value.length > 16 || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) return null;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

export const isCurrencyCode = (value: string) => /^[A-Z]{3,10}$/.test(value);
