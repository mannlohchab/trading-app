import { z } from 'zod';
import type { ResponseBlock } from '../domain/blocks';
import type { ToolSpec } from './ports';

/** Expected tool failures; the message goes back to the model so it can adjust. */
export class ToolInputError extends Error {}

// ---- Tool definitions ---------------------------------------------------------------------------

export type ToolOutcome = { result: unknown; blocks?: ResponseBlock[] };
export type AssistantTool = { spec: ToolSpec; run(args: unknown): Promise<ToolOutcome> };

export function defineTool<S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.infer<S>) => Promise<ToolOutcome>): AssistantTool {
  return {
    spec: { name, description, parameters: z.toJSONSchema(schema, { io: 'input', target: 'draft-7', reused: 'ref' }) as Record<string, unknown> },
    async run(raw) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new ToolInputError(`Invalid arguments: ${parsed.error.issues.map(i => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
      }
      return run(parsed.data);
    },
  };
}
