// The sandboxed worker process: limits, failure handling and isolation.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineError } from '../../src/modules/backtesting/engines/backtest-engine.interface';
import { ResinEngine, toSandboxRequest } from '../../src/modules/backtesting/engines/resin/resin.engine';
import { BacktestWorkerManager, verifySandboxIsolation } from '../../src/modules/backtesting/workers/backtest.worker-manager';
import { TEST_SANDBOX_MODE } from '../helpers/test-app';
import { engineInput, pine, walk } from './fixtures';

const dir = mkdtempSync(join(tmpdir(), 'worker-test-'));
const managers: BacktestWorkerManager[] = [];
afterAll(async () => { await Promise.all(managers.map(m => m.dispose())); rmSync(dir, { recursive: true, force: true }); });

/** A manager whose sandbox runs `script` instead of the real worker. */
function fakeWorker(script: string, options: Partial<ConstructorParameters<typeof BacktestWorkerManager>[0]> = {}) {
  const path = join(dir, `w${managers.length}.js`);
  writeFileSync(path, script);
  const m = new BacktestWorkerManager({ mode: TEST_SANDBOX_MODE, entryOverride: path, ...options });
  managers.push(m);
  return m;
}
const real = new BacktestWorkerManager({ mode: TEST_SANDBOX_MODE });
managers.push(real);
const ema = pine('f = ta.ema(close, 10)\ns = ta.ema(close, 30)\nif ta.crossover(f, s)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(f, s)\n    strategy.close("L")');
const request = toSandboxRequest(engineInput(ema, walk(500)));
const errorOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as EngineError; } throw new Error('expected EngineError'); };

describe('execution', () => {
  test('a normal run returns validated output', async () => {
    const r = await real.run(request);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.equity).toHaveLength(500);
  });

  test('runs past the wall-clock limit are killed', async () => {
    const slow = pine('var float n = 0\nfor i = 0 to 9999\n    for j = 0 to 9999\n        n += 1\nplot(n)');
    const started = Date.now();
    const e = await errorOf(real.run(toSandboxRequest(engineInput(slow, walk(300))), { timeoutMs: 1500 }));
    expect(e.code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(4000);
  });

  test('memory beyond the limit kills the worker', async () => {
    const hog = fakeWorker('await Bun.stdin.text(); const a = []; for (;;) a.push(new Float64Array(1_000_000).fill(1));', { memoryBytes: 512 * 1024 * 1024 });
    expect((await errorOf(hog.run(request, { timeoutMs: 20_000 }))).code).toBe('RESOURCE_LIMIT');
  });

  test('CPU time beyond the limit kills the worker', async () => {
    const spin = fakeWorker('await Bun.stdin.text(); for (;;) {}', { cpuSeconds: 1 });
    expect((await errorOf(spin.run(request, { timeoutMs: 20_000 }))).code).toBe('RESOURCE_LIMIT');
  });

  test('a crashing worker is reported, not trusted', async () => {
    expect((await errorOf(fakeWorker('await Bun.stdin.text(); process.exit(3);').run(request))).code).toBe('INVALID_OUTPUT');
  });

  test('cancellation kills the run immediately', async () => {
    const hang = fakeWorker('await Bun.stdin.text(); await new Promise(() => setInterval(() => {}, 1000));');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    expect((await errorOf(hang.run(request, { signal: controller.signal, timeoutMs: 30_000 }))).code).toBe('CANCELLED');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('concurrency is bounded; excess work is refused, not piled up', async () => {
    const hang = fakeWorker('await Bun.stdin.text(); await Bun.sleep(800); console.log("{}")', { maxConcurrent: 1, maxQueued: 0 });
    const first = hang.run(request).catch(e => e);
    await Bun.sleep(50);
    expect((await errorOf(hang.run(request))).code).toBe('BUSY');
    await first;
  });
});

describe('output validation', () => {
  test('malformed, schema-violating, oversized or inconsistent output is rejected', async () => {
    const cases = [
      'await Bun.stdin.text(); process.stdout.write("not json")',
      'await Bun.stdin.text(); console.log(JSON.stringify({ protocol: 1, ok: true, engine: { name: "resin", version: "0.3.0" }, trades: [{ entryTime: 0 }], equity: [], realizedPnl: 0, openPosition: null, durationMs: 1 }))',
      'await Bun.stdin.text(); console.log(JSON.stringify({ protocol: 1, ok: true, engine: { name: "resin", version: "0.3.0" }, trades: [], equity: [], realizedPnl: 1e400, openPosition: null, durationMs: 1, extra: "field" }))',
    ];
    for (const script of cases) expect((await errorOf(fakeWorker(script).run(request))).code).toBe('INVALID_OUTPUT');
    const big = fakeWorker('await Bun.stdin.text(); process.stdout.write("x".repeat(3_000_000))', { maxOutputBytes: 1_000_000 });
    expect((await errorOf(big.run(request))).code).toBe('INVALID_OUTPUT');
  });

  test('well-formed output that does not reconcile or fall inside the dataset is rejected by the engine', async () => {
    const lie = (trades: unknown[], realizedPnl: number, equity = 500) => fakeWorker(`await Bun.stdin.text(); console.log(JSON.stringify(${JSON.stringify({ protocol: 1, ok: true, engine: { name: 'resin', version: '0.3.0' }, trades, equity: Array(equity).fill(10000), realizedPnl, openPosition: null, durationMs: 1 })}))`);
    const t = { entryTime: request.candles.time[10], exitTime: request.candles.time[20], entryPrice: 100, exitPrice: 101, size: 1, profit: 1, profitPercent: 1, commission: 0, maxRunup: 1, maxDrawdown: 0, entryId: 'L', exitId: 'L', entryComment: '', exitComment: '' };
    const input = engineInput(ema, walk(500));
    expect((await errorOf(new ResinEngine(lie([t], 999)).run(input))).message).toContain('reconcile');
    expect((await errorOf(new ResinEngine(lie([{ ...t, exitTime: 9e15 }], 1)).run(input))).message).toContain('outside');
    expect((await errorOf(new ResinEngine(lie([t], 1, 7)).run(input))).message).toContain('candle count');
    const wrongVersion = fakeWorker(`await Bun.stdin.text(); console.log(JSON.stringify(${JSON.stringify({ protocol: 1, ok: true, engine: { name: 'resin', version: '9.9.9' }, trades: [], equity: Array(500).fill(10000), realizedPnl: 0, openPosition: null, durationMs: 1 })}))`);
    expect((await errorOf(new ResinEngine(wrongVersion).run(input))).message).toContain('pinned');
  });
});

describe.skipIf(TEST_SANDBOX_MODE !== 'bwrap')('isolation (bubblewrap)', () => {
  test('the sandbox has no environment, no network and no view of the application', async () => {
    process.env.BACKTEST_TEST_SECRET = 'super-secret-value';
    try {
      const check = await verifySandboxIsolation(real, new URL('../..', import.meta.url).pathname);
      expect(check).toMatchObject({ isolated: true, problems: [] });
      const probe = await real.probe(`
        const fs = require('fs');
        const read = p => { try { return fs.readFileSync(p, 'utf8').slice(0, 20); } catch (e) { return 'denied:' + e.code; } };
        console.log(JSON.stringify({
          secret: process.env.BACKTEST_TEST_SECRET ?? null,
          dotenv: read(${JSON.stringify(new URL('../../.env', import.meta.url).pathname)}),
          home: read('/home'),
          uid: process.getuid(),
          pid: process.pid,
          write: (() => { try { fs.writeFileSync('/usr/x', 'x'); return 'WROTE'; } catch (e) { return 'denied:' + e.code; } })(),
        }));`);
      const out = JSON.parse(probe.stdout.trim().split('\n').at(-1)!);
      expect(out.secret).toBeNull();
      expect(out.dotenv).toStartWith('denied:');
      expect(out.home).toStartWith('denied:');
      expect(out.write).toStartWith('denied:');
      expect(out.pid).toBeLessThan(10); // own PID namespace
    } finally {
      delete process.env.BACKTEST_TEST_SECRET;
    }
  });

  test('the real worker cannot use network APIs even if a script tried', async () => {
    // Capabilities are removed before any script runs; the probe confirms the namespace too.
    const probe = await real.probe(`try { await fetch('https://example.com', { signal: AbortSignal.timeout(2000) }); console.log('REACHED'); } catch (e) { console.log('blocked'); }`);
    expect(probe.stdout.trim()).toBe('blocked');
  });
});
