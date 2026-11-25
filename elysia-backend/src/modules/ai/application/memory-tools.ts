// remember / forget_memory: the assistant's long-term notes about one user. Saved facts are shown
// in the system prompt of later turns (see domain/turn-context) and listed in the app's settings.
import { z } from 'zod';
import { checkMemory, MEMORY_LIMITS, sameMemory } from '../domain/memory';
import type { MemoryRepository } from './ports';
import { defineTool, ToolInputError, type AssistantTool } from './tool-definition';

export function createMemoryTools(memories: MemoryRepository, userId: string): AssistantTool[] {
  let writes = 0;
  return [
    defineTool(
      'remember',
      'Save one lasting fact the user told you about themselves or their trading, for future conversations: goals, experience, risk limits, preferred markets or timeframes, constraints, or how they like answers. Only what they said or clearly confirmed; never market data, your own guesses, or contact details, account numbers and credentials. Mention briefly in your answer what you saved.',
      z.strictObject({ fact: z.string().min(3).max(MEMORY_LIMITS.contentMax).describe('One short sentence in the third person, e.g. "Prefers swing trades on the 4h timeframe"') }),
      async ({ fact }) => {
        if (writes >= MEMORY_LIMITS.writesPerTurn) throw new ToolInputError(`At most ${MEMORY_LIMITS.writesPerTurn} memories per answer.`);
        const checked = checkMemory(fact);
        if (!checked.ok) throw new ToolInputError(checked.error);
        const existing = await memories.list(userId);
        const duplicate = existing.find(m => sameMemory(m.content, checked.content));
        if (duplicate) return { result: { saved: false, alreadyRemembered: true, id: duplicate.id } };
        if (existing.length >= MEMORY_LIMITS.perUser) {
          throw new ToolInputError(`Memory is full (${MEMORY_LIMITS.perUser} facts). Forget an outdated one with forget_memory first, or skip saving.`);
        }
        writes++;
        const saved = await memories.add(userId, checked.content);
        return { result: { saved: true, id: saved.id, note: 'The user can review and delete memories in Profile → Settings.' } };
      },
    ),
    defineTool(
      'forget_memory',
      'Delete one remembered fact by its id, when the user asks you to forget it or says it is no longer true (then remember the new fact if they gave one).',
      z.strictObject({ id: z.string().min(1).max(64).describe('Id shown next to the memory in "What you remember"') }),
      async ({ id }) => {
        if (!(await memories.remove(userId, id))) throw new ToolInputError('No memory with that id. Use an id from "What you remember".');
        return { result: { forgotten: true, id } };
      },
    ),
  ];
}
