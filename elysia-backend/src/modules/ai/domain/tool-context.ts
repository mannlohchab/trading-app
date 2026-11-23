import type { MessageMetadata } from '../application/ports';

/** Preserve stable run references between turns without replaying large charts or stale metrics. */
export function historyContent(content: string, metadata: MessageMetadata | null | undefined): string {
  const references: unknown[] = [];
  for (const block of (metadata?.blocks ?? []).slice(-12)) {
    if (block.type === 'research_run') references.push({ kind: block.data.kind, id: block.data.id, observedStatus: block.data.status });
    else if (block.type === 'backtest_result' && block.data.backtestId) references.push({ kind: 'backtest', id: block.data.backtestId });
    else if (block.type === 'strategy_draft') references.push(block.savedStrategyId
      ? { kind: 'strategy', strategyId: block.savedStrategyId }
      : { kind: 'unsaved_strategy', draft: block.draft });
  }
  if (!references.length) return content;
  // Full definitions are small and bounded by the strategy schema; retain newest references first.
  const kept: unknown[] = [];
  let size = 0;
  for (const item of references.reverse()) {
    const encoded = JSON.stringify(item);
    if (encoded.length + size > 7000) continue;
    size += encoded.length; kept.unshift(item);
  }
  return kept.length ? `${content}\n\n[Application references from this message; fetch current state with tools. Unsaved draft identifiers do not persist across turns.]\n${JSON.stringify(kept)}` : content;
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
