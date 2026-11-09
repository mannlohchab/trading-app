import type { Context } from 'hono';
import type { z } from 'zod';

/** Parses a JSON body with `schema`; on failure returns a 400 response in the API's error shape. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<{ data: z.infer<S> } | { response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { response: c.json({ error: 'Request body must be JSON.', code: 'INVALID_JSON' }, 400) };
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(body)'] ??= issue.message;
  return { response: validationError(c, fields) };
}

export const validationError = (c: Context, fields: Record<string, string>) =>
  c.json({ error: 'Some fields are invalid.', code: 'VALIDATION_ERROR', fields }, 400);
