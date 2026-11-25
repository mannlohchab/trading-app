// Port for Morning Decode script generation. Implementations talk to MiMo, Gemini or OpenRouter server-side only.

export interface BriefScriptLlm {
  readonly name: string;
  /** Returns spoken-script prose. Must not invent market numbers beyond the facts string. */
  complete(input: { system: string; user: string; signal?: AbortSignal }): Promise<{ text: string; model: string }>;
}

export interface BriefTts {
  readonly name: string;
  speak(text: string, signal?: AbortSignal): Promise<{ bytes: Buffer; contentType: string; model: string }>;
}

/** ~150 spoken words/min; hard-cap at 4 minutes. */
export const MORNING_DECODE_MAX_SECONDS = 240;
export const MORNING_DECODE_TARGET_WORDS = 520;
export const MORNING_DECODE_MAX_WORDS = 600;

export function estimateDurationSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(MORNING_DECODE_MAX_SECONDS, Math.max(30, Math.round((words / 150) * 60)));
}

export function trimToWordBudget(script: string, maxWords = MORNING_DECODE_MAX_WORDS): string {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ').replace(/[,:;.—-]+$/, '')}.`;
}

export const MORNING_DECODE_SYSTEM = [
  'You are a professional financial news presenter writing a Morning Decode audio script.',
  'The script will be spoken aloud (no markdown, bullets, emojis, or stage directions).',
  'Cover the previous crypto trading session using ONLY the verified facts provided.',
  'Never invent prices, percentages, headlines, or events that are not in the facts.',
  'Tone: clear, calm, authoritative — like a short market radio briefing.',
  `Length: about ${MORNING_DECODE_TARGET_WORDS} words, never more than ${MORNING_DECODE_MAX_WORDS} words (under four minutes spoken).`,
  'Structure: open with the session date and overall tone; cover major movers and volume leaders; mention notable news if provided; close with one risk/watch line.',
  'Do not include disclaimers, investment advice, or calls to buy or sell.',
].join(' ');
