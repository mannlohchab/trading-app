// Conversation rules. Pure functions: no framework, database or I/O.

export const CONVERSATION_LIMITS = {
  messageMaxChars: 4000,
  titleMaxChars: 80,
  /** Earlier messages sent back to the model, newest first, until either limit is hit. */
  historyMaxMessages: 20,
  historyMaxChars: 24_000,
  /** Model ↔ tool round trips per assistant turn. */
  maxToolRounds: 4,
  maxToolCallsPerRound: 5,
} as const;

export type HistoryMessage = { role: 'USER' | 'ASSISTANT'; content: string };

/** Title for a new conversation from its first message (no extra model call). */
export function titleFromMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= CONVERSATION_LIMITS.titleMaxChars) return oneLine || 'New conversation';
  const cut = oneLine.slice(0, CONVERSATION_LIMITS.titleMaxChars - 1);
  const atWord = cut.slice(0, cut.lastIndexOf(' ')).trim();
  return `${atWord.length > 20 ? atWord : cut}…`;
}

/** Most recent messages that fit the budget, oldest first. Never starts with an assistant reply. */
export function selectHistory(messages: HistoryMessage[]): HistoryMessage[] {
  const picked: HistoryMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && picked.length < CONVERSATION_LIMITS.historyMaxMessages; i--) {
    const m = messages[i]!;
    if (chars + m.content.length > CONVERSATION_LIMITS.historyMaxChars) break;
    chars += m.content.length;
    picked.unshift(m);
  }
  while (picked[0]?.role === 'ASSISTANT') picked.shift();
  return picked;
}
