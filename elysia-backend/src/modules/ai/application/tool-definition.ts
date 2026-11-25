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
      const parsed = schema.safeParse(coerceToSchema(raw, parameters));
      if (!parsed.success) {
        throw new ToolInputError(`Invalid arguments: ${parsed.error.issues.map(i => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
      }
      return run(parsed.data);
    },
  };
}
