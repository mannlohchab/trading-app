import type { z } from 'zod';

/** Read the raw request once, retaining the existing API's validation response format. */
export async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<{ data: z.infer<S> } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: Response.json({ error: 'Request body must be JSON.', code: 'INVALID_JSON' }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(body)'] ??= issue.message;
  return { response: validationError(fields) };
}

export const validationError = (fields: Record<string, string>) =>
  Response.json({ error: 'Some fields are invalid.', code: 'VALIDATION_ERROR', fields }, { status: 400 });
