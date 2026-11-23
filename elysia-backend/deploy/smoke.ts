// Run from the release application directory, e.g. docker exec -i -w /app CONTAINER bun - < this-file.
// No database/config imports, user records, orders, or persistent application writes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const appDir = process.cwd();
const moduleUrl = (path: string) => pathToFileURL(join(appDir, 'src/modules/backtesting', path)).href;
const { BacktestWorkerManager, verifySandboxIsolation } = await import(moduleUrl('workers/backtest.worker-manager.ts'));
const { ResinEngine, toSandboxRequest } = await import(moduleUrl('engines/resin/resin.engine.ts'));
const managers: InstanceType<typeof BacktestWorkerManager>[] = [];
const scratch = mkdtempSync(join(tmpdir(), 'elysia-release-smoke-'));
const started = performance.now();

function manager(options: Record<string, unknown> = {}) {
  const instance = new BacktestWorkerManager({ mode: 'bwrap', maxConcurrent: 1, maxQueued: 0, ...options });
  managers.push(instance);
  return instance;
}

async function boundedFailure(worker: InstanceType<typeof BacktestWorkerManager>, request: unknown, timeoutMs: number, expected: string) {
  const start = performance.now();
  let code: string | undefined;
  try {
    await worker.run(request, { timeoutMs });
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  assert.equal(code, expected, `Expected ${expected}; received ${code ?? 'success or unclassified error'}`);
  const elapsedMs = Math.round(performance.now() - start);
  assert.ok(elapsedMs < timeoutMs + 3_000, 'Worker did not terminate promptly');
  return { code, elapsedMs };
}

try {
  for (const path of ['/proc/keys', '/proc/kcore', '/proc/interrupts']) {
    let denied = false;
    try { readFileSync(path); } catch (error) {
      denied = ['EACCES', 'EPERM', 'ENOENT'].includes((error as { code: string }).code);
    }
    assert.equal(denied, true, `Outer container path protection absent: ${path}`);
  }
  const workers = manager({ cpuSeconds: 10 });
  const isolation = await verifySandboxIsolation(workers, appDir);
  assert.equal(isolation.isolated, true, 'Sandbox isolation check failed');
  assert.deepEqual(isolation.problems, []);
  assert.deepEqual(isolation.result.envKeys, []);
  assert.equal(isolation.result.network, 'blocked');
  assert.equal(isolation.result.appDir, 'hidden');

  // Compare namespaces directly: a failed HTTP request alone is insufficient evidence
  // when the outer test container also has no network access.
  const namespaceProbe = await workers.probe(`
    const fs = require('node:fs');
    console.log(JSON.stringify({
      net: fs.readlinkSync('/proc/self/ns/net'),
      pid: fs.readlinkSync('/proc/self/ns/pid'),
      user: fs.readlinkSync('/proc/self/ns/user'),
      mount: fs.readlinkSync('/proc/self/ns/mnt'),
      capabilities: fs.readFileSync('/proc/self/status', 'utf8').match(/^CapEff:\\s*(\\w+)$/m)?.[1],
      protectedPaths: ['/proc/keys', '/proc/kcore', '/proc/interrupts'].every(path => {
        try { fs.readFileSync(path); return false; } catch (e) { return ['EACCES', 'EPERM', 'ENOENT'].includes(e.code); }
      }),
    }));
  `);
  assert.equal(namespaceProbe.exitCode, 0, namespaceProbe.stderr);
  const namespaces = JSON.parse(namespaceProbe.stdout.trim());
  for (const [key, name] of [['net', 'net'], ['pid', 'pid'], ['user', 'user'], ['mount', 'mnt']]) {
    assert.notEqual(namespaces[key], readlinkSync(`/proc/self/ns/${name}`), `${key} namespace was shared with the API`);
  }
  assert.equal(BigInt(`0x${namespaces.capabilities}`), 0n, 'Strategy worker retained effective capabilities');
  assert.equal(namespaces.protectedPaths, true, 'Worker path protection absent');

  const hour = 3_600_000;
  const firstOpen = Date.UTC(2026, 0, 1);
  const candles = Array.from({ length: 300 }, (_, i) => {
    const open = 100 + i * 0.25;
    return {
      openTime: firstOpen + i * hour,
      closeTime: firstOpen + (i + 1) * hour - 1,
      open: open.toFixed(2), high: (open + 0.5).toFixed(2),
      low: (open - 0.5).toFixed(2), close: (open + 0.25).toFixed(2), volume: '1000',
    };
  });
  const input = {
    script: {
      language: 'pine', version: 6, generatedFrom: 'strategy_definition_v1',
      source: `//@version=6
strategy("Release smoke")
entrySignal = bar_index % 30 == 1
exitSignal = bar_index % 30 == 20
if entrySignal
    strategy.entry("L", strategy.long)
if exitSignal
    strategy.close("L")
`,
    },
    candles, timeframe: '1h',
    symbol: { exchange: 'BINANCE', symbol: 'SMOKEUSDT', baseAsset: 'SMOKE', quoteAsset: 'USDT', tickSize: '0.01', lotSize: '0.001' },
    settings: { initialCapital: '10000', commissionPercent: '0', slippageTicks: 0, positionSizing: { type: 'fixed_quantity', value: '1' } },
  };
  const engine = new ResinEngine(workers);
  const result = await engine.run(input, { timeoutMs: 15_000 });
  assert.equal(result.equity.length, 300);
  assert.equal(result.trades.length, 10);
  assert.equal(result.openPosition, null);
  assert.equal(result.realizedPnl, '47.5');
  assert.equal(result.equity.at(-1), '10047.5');
  assert.ok(result.equity.every((value: string) => Number.isFinite(Number(value))));
  for (let i = 0; i < result.trades.length; i++) {
    const trade = result.trades[i];
    assert.equal(trade.entryTime, candles[i * 30 + 2]!.openTime);
    assert.equal(trade.exitTime, candles[i * 30 + 21]!.openTime);
    assert.equal(trade.side, 'LONG');
    assert.equal(trade.quantity, '1');
    assert.equal(trade.profit, '4.75');
    assert.equal(trade.commission, '0');
  }

  // Signals use the real engine as well, but do not submit orders or touch a database.
  const signals = await engine.signals({ ...input, bars: 60 }, { timeoutMs: 15_000 });
  assert.equal(signals.bars.length, 60);
  assert.equal(signals.bars.filter((bar: { entry: boolean }) => bar.entry).length, 2);
  assert.equal(signals.bars.filter((bar: { exit: boolean }) => bar.exit).length, 2);

  // Trusted throwaway worker entries exercise both enforced limits without allocating large memory.
  const sleepPath = join(scratch, 'sleep.js');
  writeFileSync(sleepPath, 'await Bun.stdin.text(); await Bun.sleep(60000);\n', { mode: 0o600 });
  const spinPath = join(scratch, 'spin.js');
  writeFileSync(spinPath, 'await Bun.stdin.text(); for (;;) {}\n', { mode: 0o600 });
  const request = toSandboxRequest(input);
  const wallLimit = await boundedFailure(manager({ entryOverride: sleepPath, cpuSeconds: 1 }), request, 350, 'TIMEOUT');
  const cpuLimit = await boundedFailure(manager({ entryOverride: spinPath, cpuSeconds: 1 }), request, 5_000, 'RESOURCE_LIMIT');

  console.log(JSON.stringify({
    ok: true,
    isolation: { environment: 'empty', network: 'blocked', applicationDirectory: 'hidden', namespaces: 'separate', capabilities: 'none', protectedPaths: 'denied' },
    fixture: { source: 'synthetic deterministic candles', candles: 300, trades: result.trades.length, equityPoints: result.equity.length, realizedPnl: result.realizedPnl, finalEquity: result.equity.at(-1), engine: result.engine },
    signals: { bars: signals.bars.length, entries: 2, exits: 2 },
    limits: { wall: wallLimit, cpu: cpuLimit },
    durationMs: Math.round(performance.now() - started),
  }));
} catch (error) {
  // Only these locally defined assertions and engine error codes are reported; no environment values.
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Smoke test failed', code: (error as { code?: string })?.code ?? null }));
  process.exitCode = 1;
} finally {
  await Promise.all(managers.map(instance => instance.dispose()));
  rmSync(scratch, { recursive: true, force: true });
}
