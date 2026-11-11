// Product rule: the assistant explains strategies in plain words and charts. It never hands out raw
// definitions (JSON, Pine Script or any other code). The prompt asks for this; this filter enforces
// it, because smaller models sometimes copy a tool's argument format into their answer instead.

/**
 * Removes fenced code blocks (```…```) from streamed text. Fences may be split across chunks, so up
 * to two trailing backticks are held back until the next chunk shows what they are.
 */
export function createCodeFilter() {
  let inCode = false;
  let pending = '';
  let removed = false;
  return {
    push(chunk: string): string {
      let s = pending + chunk;
      pending = '';
      let out = '';
      for (;;) {
        const fence = s.indexOf('```');
        if (fence === -1) {
          const hold = /`{1,2}$/.exec(s)?.[0] ?? '';
          if (!inCode) out += s.slice(0, s.length - hold.length);
          pending = hold;
          return out;
        }
        if (!inCode) out += s.slice(0, fence);
        inCode = !inCode;
        removed = true;
        s = s.slice(fence + 3);
      }
    },
    /** Text still held back at the end of the stream. An unclosed block is dropped. */
    flush(): string {
      const rest = inCode ? '' : pending;
      pending = '';
      return rest;
    },
    get removed() { return removed; },
  };
}

/** Shown when a reply was nothing but code. */
export const CODE_REMOVED_FALLBACK =
  'I can\'t share raw strategy code or definitions here. Ask me to walk you through the strategy\'s rules in plain words, or to show them on a chart.';
