// Lossless parser for Postgres `json` (OID 114) values.
//
// Drizzle's relational queries (`db.query.x.findMany({ with: … })`) return nested rows as `json`.
// Plain JSON.parse would turn NUMERIC money values into JS floats and silently corrupt them
// (123456789012345678.123456789012 → 123456789012345680). This parser keeps any number whose
// text would change as the exact source string, matching what flat selects return for NUMERIC.
// Small integers and other round-trippable numbers stay numbers. `jsonb` columns are unaffected.

export const JSON_OID = 114;

type ReviverContext = { source?: string };

export function parseJsonLossless(text: string): unknown {
  return JSON.parse(text, (_key, value, context?: ReviverContext) =>
    typeof value === 'number' && context?.source !== undefined && String(value) !== context.source
      ? context.source
      : value,
  );
}
