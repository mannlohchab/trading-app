// Sandboxed backtest worker: the only code that executes strategy scripts.
//
// Runs as its own OS process inside the sandbox described in backtest.worker-manager.ts (no network,
// no environment, no view of the application's files, CPU/memory/time limits). It reads exactly one
// request from stdin and writes exactly one response to stdout. It must never import application
// modules that read configuration or secrets: it is bundled on its own, and only this bundle is
// visible inside the sandbox.
import { executeResin, executeResinSignals } from '../engines/resin/resin.adapter';
import { PROTOCOL_VERSION, sandboxRequestSchema, sandboxResponseSchema, sandboxSignalsResultSchema, type SandboxResponse, type SandboxSignalsResult } from './protocol';

/** Defence in depth: the sandbox has no network, but don't leave the APIs lying around either. */
function dropCapabilities() {
  const g = globalThis as Record<string, unknown>;
  for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'navigator']) {
    try { delete g[name]; } catch { /* non-configurable */ }
    try { if (name in g) Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
  }
  const bun = g.Bun as Record<string, unknown> | undefined;
  for (const name of ['spawn', 'spawnSync', 'connect', 'listen', 'serve', 'udpSocket', 'file', 'write', 'openInEditor', 'sql', 'SQL', 's3', 'S3Client', 'redis', 'RedisClient']) {
    try { if (bun && name in bun) Object.defineProperty(bun, name, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
  }
}

function write(response: SandboxResponse | SandboxSignalsResult) {
  process.stdout.write(JSON.stringify(response));
}

const fail = (message: string): SandboxResponse => ({ protocol: PROTOCOL_VERSION, ok: false, code: 'INVALID_INPUT', message, details: [] });

async function main() {
  const text = await Bun.stdin.text();
  dropCapabilities();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return write(fail('Request is not JSON')); }
  const request = sandboxRequestSchema.safeParse(body);
  if (!request.success) return write(fail(`Invalid request: ${request.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`));

  if (request.data.mode === 'signals') {
    const signals = sandboxSignalsResultSchema.safeParse(executeResinSignals(request.data));
    return write(signals.success ? signals.data : { protocol: PROTOCOL_VERSION, ok: false, code: 'RUNTIME_ERROR', message: 'Engine produced malformed signals', details: [] });
  }
  const response = executeResin(request.data);
  // Validate our own output too: a broken engine must not hand the trusted side malformed data.
  const checked = sandboxResponseSchema.safeParse(response);
  write(checked.success ? checked.data : { protocol: PROTOCOL_VERSION, ok: false, code: 'RUNTIME_ERROR', message: 'Engine produced malformed output', details: checked.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) });
}

await main();
