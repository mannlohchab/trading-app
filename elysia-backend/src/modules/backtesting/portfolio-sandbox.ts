import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { BacktestWorkerManager, type SandboxMode } from './workers/backtest.worker-manager';
import { EngineError } from './engines/backtest-engine.interface';

const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) }),
  z.object({ ok: z.literal(false), error: z.string().max(10_000) }),
]);

export class PortfolioSandbox {
  private preparation?: Promise<{ manager: BacktestWorkerManager; directory: string }>;
  constructor(private mode: SandboxMode) {}
  private prepare() {
    this.preparation ??= (async () => {
      const directory = mkdtempSync(join(tmpdir(), 'portfolio-worker-'));
      try {
        const output = await Bun.build({ entrypoints: [new URL('./research/portfolio.worker.ts', import.meta.url).pathname], outdir: directory, naming: 'portfolio.js', target: 'bun' });
        if (!output.success) throw new Error(output.logs.map(l => l.message).join('; '));
        return { directory, manager: new BacktestWorkerManager({ mode: this.mode, entryOverride: join(directory, 'portfolio.js'), maxConcurrent: 2, maxQueued: 8 }) };
      } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
    })();
    this.preparation.catch(() => { this.preparation = undefined; });
    return this.preparation;
  }
  async run(dataset: unknown, execution: unknown, signal?: AbortSignal) {
    const { manager } = await this.prepare();
    const response = await manager.runTask({ dataset, execution }, responseSchema, { signal, timeoutMs: 60_000 });
    if (!response.ok) throw new EngineError('INVALID_INPUT', response.error);
    return response.result;
  }
  async dispose() {
    const prepared = await this.preparation?.catch(() => undefined);
    if (prepared) { await prepared.manager.dispose(); rmSync(prepared.directory, { recursive: true, force: true }); }
    this.preparation = undefined;
  }
}
