import type { MessageMetadata } from '../application/ports';

const REFERENCES_MARKER = '[Application references';

/**
 * Stable run references from one assistant reply (backtests, research runs, strategies), so a later
 * turn can resolve "that backtest" without replaying large charts or stale metrics. Newest kept first
 * within a size budget. These go to the model in the system prompt, never inside the reply text:
 * replies that "ended" with a reference footer taught the model to write that footer to the user.
 */
export function historyReferences(metadata: MessageMetadata | null | undefined): unknown[] {
  const references: unknown[] = [];
  for (const block of (metadata?.blocks ?? []).slice(-12)) {
    if (block.type === 'research_run') references.push({ kind: block.data.kind, id: block.data.id, observedStatus: block.data.status });
    else if (block.type === 'backtest_result' && block.data.backtestId) references.push({ kind: 'backtest', id: block.data.backtestId });
    else if (block.type === 'strategy_draft') references.push(block.savedStrategyId
      ? { kind: 'strategy', strategyId: block.savedStrategyId }
      : { kind: 'unsaved_strategy', draft: block.draft });
  }
  // Full definitions are small and bounded by the strategy schema; retain newest references first.
  const kept: unknown[] = [];
  let size = 0;
  for (const item of references.reverse()) {
    const encoded = JSON.stringify(item);
    if (encoded.length + size > 7000) continue;
    size += encoded.length; kept.unshift(item);
  }
  return kept;
}

/** System-prompt lines for the references of earlier replies (oldest first), within a size budget. */
export function renderHistoryReferences(perReply: unknown[][], maxChars = 12_000): string[] {
  const lines: string[] = [];
  let size = 0;
  for (let i = perReply.length - 1; i >= 0; i--) {
    if (!perReply[i]!.length) continue;
    const ago = perReply.length - i;
    const line = `- Your reply ${ago === 1 ? 'just before this message' : `${ago} replies ago`}: ${JSON.stringify(perReply[i])}`;
    if (size + line.length > maxChars) break;
    size += line.length; lines.unshift(line);
  }
  return lines;
}

/** End index (exclusive) of the JSON array or object starting at `start`, or -1 if it never closes. */
function jsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { if (--depth === 0) return i + 1; }
  }
  return -1;
}

/**
 * Removes the internal reference footer ("[Application references …]" plus its JSON) from reply
 * text. Replies saved before references moved to the system prompt carry it, and a model may still
 * copy it from them.
 */
export function stripReferenceEcho(text: string): string {
  let out = text;
  for (let at = out.indexOf(REFERENCES_MARKER); at !== -1; at = out.indexOf(REFERENCES_MARKER, at)) {
    const close = out.indexOf(']', at);
    if (close === -1) { out = out.slice(0, at); break; }
    let end = close + 1;
    const next = out.slice(end).search(/\S/);
    if (next !== -1 && (out[end + next] === '[' || out[end + next] === '{')) {
      const jsonClose = jsonEnd(out, end + next);
      end = jsonClose === -1 ? out.length : jsonClose;
    }
    out = out.slice(0, at) + out.slice(end);
  }
  return out === text ? text : out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Tool messages must remain parseable JSON when a report exceeds the model context budget. */
export function toolResultContent(value: unknown, maxChars = 24_000): string {
  const original = JSON.stringify(value) ?? 'null';
  if (original.length <= maxChars) return original;
  const priority = ['id', 'status', 'kind', 'simulated', 'executionMode', 'error', 'warnings', 'notice', 'assumptions', 'market', 'range', 'settings', 'summary', 'metrics', 'result'];
  for (let budget = Math.floor(maxChars * 0.7); budget > 200; budget = Math.floor(budget / 2)) {
    let remaining = budget;
    const trim = (v: unknown, depth = 0): unknown => {
      if (remaining <= 0 || depth > 10) return '[omitted]';
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string') { const n = Math.min(v.length, 1500, remaining); remaining -= n + 12; return n < v.length ? `${v.slice(0, n)}… [truncated]` : v; }
      if (Array.isArray(v)) {
        const items: unknown[] = [];
        for (const item of v.slice(0, 30)) { if (remaining <= 0) break; items.push(trim(item, depth + 1)); }
        return items;
      }
      if (v && typeof v === 'object') {
        const result: Record<string, unknown> = Object.create(null);
        const entries = Object.entries(v).sort(([a], [b]) => {
          const ai = priority.indexOf(a), bi = priority.indexOf(b);
          return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
        });
        for (const [key, item] of entries) {
          if (remaining <= 0) break;
          remaining -= key.length + 12;
          result[key] = trim(item, depth + 1);
          if (Array.isArray(item)) result[`${key}Total`] = item.length;
        }
        return result;
      }
      remaining -= 32; return v;
    };
    const result = JSON.stringify({ truncated: true, notice: 'Bounded preview; omitted rows are not part of this response. Request a narrower report/page or open the run card. Do not infer totals from these arrays.', preview: trim(value) });
    if (result.length <= maxChars) return result;
  }
  return JSON.stringify({ truncated: true, notice: 'Report too large. Request a narrower report or open the run card.' });
}
