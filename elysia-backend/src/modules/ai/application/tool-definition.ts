import { z } from 'zod';
import type { ResponseBlock } from '../domain/blocks';
import type { ToolSpec } from './ports';
import { coerceToSchema } from './tool-arguments';

/** Expected tool failures; the message goes back to the model so it can adjust. */
export class ToolInputError extends Error {}

// ---- Tool definitions ---------------------------------------------------------------------------

export type ToolOutcome = { result: unknown; blocks?: ResponseBlock[] };
export type AssistantTool = {
  spec: ToolSpec;
  /**
   * Output is only for the app (e.g. buttons). When every call in a step is terminal and the model
   * already wrote its answer in that step, the turn ends without another model round.
   */
  terminal?: boolean;
  run(args: unknown): Promise<ToolOutcome>;
};

export function defineTool<S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.infer<S>) => Promise<ToolOutcome>, options?: { terminal?: boolean }): AssistantTool {
  // Inline (no $ref): every parameter states its own type, which providers need to convert
  // text-written arguments ("200") into JSON values (200).
  const parameters = z.toJSONSchema(schema, { io: 'input', target: 'draft-7', reused: 'inline' }) as Record<string, unknown>;
  return {
    spec: { name, description, parameters },
    ...(options?.terminal && { terminal: true }),
    async run(raw) {
      const input = coerceToSchema(raw, parameters);
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        throw new ToolInputError(`Invalid arguments: ${parsed.error.issues.map(i => `${i.path.join('.') || 'args'}: ${i.message}${stringInsteadOfJson(input, i)}`).join('; ')}`);
      }
      return run(parsed.data);
    },
  };
}

/**
 * When a nested object or list arrives as a string that is not valid JSON, the plain "expected
 * object, received string" does not tell the model what to fix; this adds the parser's complaint.
 */
function stringInsteadOfJson(input: unknown, issue: z.core.$ZodIssue): string {
  if (issue.code !== 'invalid_type' || (issue.expected !== 'object' && issue.expected !== 'array')) return '';
  let value: unknown = input;
  for (const key of issue.path) value = value && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key as PropertyKey] : undefined;
  if (typeof value !== 'string') return '';
  try {
    JSON.parse(value);
    return '';
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : 'invalid JSON';
    return ` (it was sent as a string that is not valid JSON: ${reason}). Send it as a JSON ${issue.expected}, not a string, and check quotes and commas.`;
  }
}
