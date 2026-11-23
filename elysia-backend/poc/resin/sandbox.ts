// Runs a backtest in a dedicated worker thread with a wall-clock timeout and an empty environment.
// Compiled Pine code executes via `new Function`; the worker contains runaway scripts (infinite
// loops, huge allocations) and keeps process secrets out of reach. It is NOT a security boundary
// against a malicious engine bug: production should use a separate process/container with no
// network or credentials (see FINDINGS.md).
import type { BacktestInput, BacktestResult } from './pine-backtest';

export type SandboxResult = BacktestResult | { ok: false; stage: 'timeout' | 'crashed'; errors: string[] };

export function runSandboxed(input: BacktestInput, options: { timeoutMs?: number } = {}): Promise<SandboxResult> {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./sandbox-worker.ts', import.meta.url), { env: {}, smol: true } as WorkerOptions);
    const finish = (result: SandboxResult) => { clearTimeout(timer); worker.terminate(); resolve(result); };
    const timer = setTimeout(() => finish({ ok: false, stage: 'timeout', errors: [`Backtest exceeded ${options.timeoutMs ?? 10_000} ms`] }), options.timeoutMs ?? 10_000);
    worker.onmessage = (event: MessageEvent<BacktestResult>) => finish(event.data);
    worker.onerror = event => finish({ ok: false, stage: 'crashed', errors: [event.message || 'Worker crashed'] });
    worker.postMessage(input);
  });
}
