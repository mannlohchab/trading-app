// Tool calls that a model wrote into its answer text instead of the API's tool_calls field.
// Nemotron (and Qwen-family models) natively write
//   <tool_call><function=NAME><parameter=KEY>VALUE</parameter>…</function></tool_call>
// and Hermes-style models write <tool_call>{"name": …, "arguments": {…}}</tool_call>. When the
// provider does not convert that into a real call (or no tools were offered), the markup arrives as
// text. Users must never see it: this filter removes it from the stream and returns the calls it
// could read, so the assistant can run them. Pure; no I/O.

export type TextToolCall = { name: string; arguments: string };

const OPENERS = ['<tool_call>', '<function='] as const;
const CLOSER: Record<(typeof OPENERS)[number], string> = { '<tool_call>': '</tool_call>', '<function=': '</function>' };

/** Length of the longest suffix of `text` that could be the start of an opener. */
function partialOpener(text: string): number {
  for (let n = Math.min(text.length, 11); n > 0; n--) {
    const tail = text.slice(-n);
    if (OPENERS.some(o => o.startsWith(tail))) return n;
  }
  return 0;
}

const unwrap = (value: string) => value.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

/** Reads one block. Returns null when no function name can be found. */
export function parseToolMarkup(block: string): TextToolCall | null {
  const inner = block.replace(/^\s*<tool_call>/, '').replace(/<\/tool_call>\s*$/, '').trim();
  if (inner.startsWith('{')) {
    try {
      const json = JSON.parse(inner) as { name?: unknown; arguments?: unknown; parameters?: unknown };
      if (typeof json.name !== 'string' || !json.name) return null;
      const args = json.arguments ?? json.parameters ?? {};
      return { name: json.name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
    } catch {
      return null;
    }
  }
  const fn = /<function=([\w.-]+)>/.exec(inner);
  if (!fn) return null;
  const args: Record<string, string> = {};
  for (const p of inner.slice(fn.index).matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) args[p[1]!] = unwrap(p[2]!);
  // Values stay strings here; the tool's schema converts them to numbers, lists or objects.
  return { name: fn[1]!, arguments: JSON.stringify(args) };
}

export function createToolMarkupFilter() {
  let pending = '';
  let closer: string | null = null;
  const calls: TextToolCall[] = [];
  let removed = false;

  const take = (block: string) => {
    removed = true;
    const call = parseToolMarkup(block);
    if (call) calls.push(call);
  };

  return {
    /** Returns the text that is safe to show now. */
    push(chunk: string): string {
      pending += chunk;
      let out = '';
      for (;;) {
        if (closer) {
          const end = pending.indexOf(closer);
          if (end === -1) return out;
          take(pending.slice(0, end + closer.length));
          pending = pending.slice(end + closer.length);
          closer = null;
          continue;
        }
        const starts = OPENERS.map(o => [o, pending.indexOf(o)] as const).filter(([, i]) => i !== -1).sort((a, b) => a[1] - b[1]);
        if (starts.length) {
          const [opener, at] = starts[0]!;
          out += pending.slice(0, at);
          pending = pending.slice(at);
          closer = CLOSER[opener];
          continue;
        }
        const hold = partialOpener(pending);
        out += pending.slice(0, pending.length - hold);
        pending = pending.slice(pending.length - hold);
        return out;
      }
    },
    /** End of stream: an unterminated block is still removed (and read if possible). */
    flush(): string {
      const rest = pending;
      pending = '';
      if (closer) { closer = null; take(rest); return ''; }
      return rest;
    },
    get calls() { return calls; },
    get removed() { return removed; },
  };
}

/** Text with every tool-call block removed (for stored replies written before this filter existed). */
export function stripToolMarkup(text: string): string {
  const filter = createToolMarkupFilter();
  return (filter.push(text) + filter.flush()).replace(/\n{3,}/g, '\n\n').trim();
}
