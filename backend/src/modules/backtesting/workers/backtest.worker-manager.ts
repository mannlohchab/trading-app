// Launches sandboxed backtest workers. This is the trusted side of the isolation boundary.
//
// Isolation, per run (mode "bwrap", the production default):
//   prlimit  --as=<memory> --cpu=<seconds> --fsize=1MiB --nofile=64     hard kernel resource limits
//   bwrap    --unshare-all                     new network (no interfaces), PID, IPC, UTS, user and
//                                              cgroup namespaces: no network access at all
//            --clearenv                        no environment variables (no secrets)
//            --ro-bind /usr, /lib*             system libraries only; the application directory,
//                                              .env files and home directories are not mounted
//            --ro-bind <bun> /sandbox/bun      the runtime binary
//            --ro-bind <bundle> /sandbox/worker.js   the self-contained worker bundle, nothing else
//            --tmpfs /tmp --die-with-parent --new-session
//   + a wall-clock timeout and output-size cap enforced here (SIGKILL on breach).
//
// Mode "process" (prlimit + empty environment, no namespaces) exists for hosts where unprivileged
// namespaces are unavailable; it is only acceptable inside a container that is itself network- and
// secret-isolated, and config refuses it in production unless explicitly declared so.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineError } from '../engines/backtest-engine.interface';
import { SANDBOX_LIMITS } from '../backtesting.constants';
import type { z } from 'zod';
import { sandboxResponseSchema, sandboxSignalsResultSchema, type SandboxRequest, type SandboxResponse, type SandboxSignalsResult } from './protocol';

export type SandboxMode = 'bwrap' | 'process';

export type WorkerManagerOptions = {
  mode: SandboxMode;
  memoryBytes?: number;
  cpuSeconds?: number;
  maxOutputBytes?: number;
  maxConcurrent?: number;
  maxQueued?: number;
  /** Tests only: run this script in the sandbox instead of the worker bundle. */
  entryOverride?: string;
  log?: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
};

type Sandbox = { bunPath: string; bundlePath: string; prlimitPath: string; bwrapPath: string | null; dir: string };

export class BacktestWorkerManager {
  private sandbox: Promise<Sandbox> | undefined;
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly options: WorkerManagerOptions) {}

  /** Runs one request in a fresh sandboxed process. */
  async run(request: SandboxRequest, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<SandboxResponse> {
    return this.execute(request, sandboxResponseSchema, opts);
  }

  /** Signals mode (live strategies): the script's latest entry/exit signals. */
  async runSignals(request: SandboxRequest, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<SandboxSignalsResult> {
    return this.execute({ ...request, mode: 'signals' }, sandboxSignalsResultSchema, opts);
  }

  private async execute<T>(request: SandboxRequest, schema: z.ZodType<T>, opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    const sandbox = await this.prepare();
    await this.acquire(opts.signal);
    try {
      return await this.spawn(sandbox, JSON.stringify(request), opts.timeoutMs ?? SANDBOX_LIMITS.wallTimeoutMs, schema, opts.signal);
    } finally {
      this.release();
    }
  }

  /** Runs `script` (source code) in the sandbox and returns its stdout; used to verify isolation. */
  async probe(script: string, timeoutMs = 10_000): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'backtest-probe-'));
    try {
      const path = join(dir, 'probe.js');
      await Bun.write(path, script);
      const base = await this.prepare();
      const proc = Bun.spawn(this.command({ ...base, bundlePath: path }), { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: {} });
      const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      clearTimeout(timer);
      return { exitCode, stdout, stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Builds the worker bundle and resolves tools once. Fails fast if the sandbox can't work here. */
  prepare(): Promise<Sandbox> {
    this.sandbox ??= (async () => {
      const prlimitPath = Bun.which('prlimit');
      if (!prlimitPath) throw new EngineError('SANDBOX_UNAVAILABLE', 'prlimit (util-linux) is required for backtest sandboxing');
      const bwrapPath = this.options.mode === 'bwrap' ? Bun.which('bwrap') : null;
      if (this.options.mode === 'bwrap' && !bwrapPath) throw new EngineError('SANDBOX_UNAVAILABLE', 'bubblewrap (bwrap) is required for backtest sandboxing');
      const dir = mkdtempSync(join(tmpdir(), 'backtest-worker-'));
      let bundlePath = this.options.entryOverride ?? '';
      if (!bundlePath) {
        const built = await Bun.build({ entrypoints: [new URL('./backtest.worker.ts', import.meta.url).pathname], target: 'bun', outdir: dir, naming: 'backtest.worker.js' });
        if (!built.success) throw new EngineError('SANDBOX_UNAVAILABLE', `Could not build the backtest worker: ${built.logs.map(l => l.message).join('; ')}`);
        bundlePath = join(dir, 'backtest.worker.js');
      }
      return { bunPath: process.execPath, bundlePath, prlimitPath, bwrapPath, dir };
    })();
    this.sandbox.catch(() => { this.sandbox = undefined; }); // allow a later retry
    return this.sandbox;
  }

  private command(s: Sandbox): string[] {
    const limits = [
      s.prlimitPath,
      `--as=${this.options.memoryBytes ?? SANDBOX_LIMITS.memoryBytes}`,
      `--cpu=${this.options.cpuSeconds ?? SANDBOX_LIMITS.cpuSeconds}`,
      '--fsize=1048576',
      '--nofile=64',
      '--core=0',
      '--',
    ];
    if (this.options.mode === 'process') return [...limits, s.bunPath, s.bundlePath];
    return [
      ...limits,
      s.bwrapPath!,
      '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind-try', '/lib', '/lib',
      '--ro-bind-try', '/lib64', '/lib64',
      '--ro-bind-try', '/lib32', '/lib32',
      '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache',
      '--ro-bind', s.bunPath, '/sandbox/bun',
      '--ro-bind', s.bundlePath, '/sandbox/worker.js',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--chdir', '/tmp',
      '/sandbox/bun', '/sandbox/worker.js',
    ];
  }

  private async spawn<T>(s: Sandbox, input: string, timeoutMs: number, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new EngineError('CANCELLED', 'Backtest cancelled');
    let proc: ReturnType<typeof Bun.spawn<'pipe', 'pipe', 'pipe'>>;
    try {
      proc = Bun.spawn(this.command(s), { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: {}, cwd: s.dir });
    } catch (error) {
      throw new EngineError('SANDBOX_UNAVAILABLE', `Could not start the backtest sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
    let stopReason: 'timeout' | 'cancelled' | 'output' | null = null;
    const kill = (reason: typeof stopReason) => { stopReason ??= reason; proc.kill('SIGKILL'); };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const onAbort = () => kill('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      proc.stdin.write(input);
      await proc.stdin.end();
    } catch { /* the process may already have died; classified below */ }

    const maxOut = this.options.maxOutputBytes ?? SANDBOX_LIMITS.maxOutputBytes;
    const [stdout, stderr, exitCode] = await Promise.all([
      readLimited(proc.stdout, maxOut, () => kill('output')),
      readLimited(proc.stderr, SANDBOX_LIMITS.maxStderrBytes),
      proc.exited,
    ]);
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    const meta = { exitCode, signal: proc.signalCode, stderr: stderr.slice(0, 500) };
    if (stopReason === 'cancelled') throw new EngineError('CANCELLED', 'Backtest cancelled');
    if (stopReason === 'timeout') throw new EngineError('TIMEOUT', `Backtest exceeded its ${Math.round(timeoutMs / 1000)} s time limit`);
    if (stopReason === 'output') throw new EngineError('INVALID_OUTPUT', 'Backtest output exceeded the size limit');
    if (proc.signalCode === 'SIGKILL' || proc.signalCode === 'SIGXCPU' || exitCode === 137 || exitCode === 152) {
      this.options.log?.('warn', 'Backtest worker killed by resource limit', meta);
      throw new EngineError('RESOURCE_LIMIT', 'Backtest exceeded its CPU limit');
    }
    if (exitCode !== 0) {
      if (/^bwrap:/m.test(stderr)) {
        this.options.log?.('error', 'Sandbox failed to start', meta);
        throw new EngineError('SANDBOX_UNAVAILABLE', 'The backtest sandbox could not start');
      }
      if (/out of memory|RangeError: Out of memory|Bun v\d|panic|Segmentation fault/i.test(stderr)) {
        this.options.log?.('warn', 'Backtest worker exceeded memory', meta);
        throw new EngineError('RESOURCE_LIMIT', 'Backtest exceeded its memory limit');
      }
      this.options.log?.('error', 'Backtest worker crashed', meta);
      throw new EngineError('INVALID_OUTPUT', 'The backtest worker crashed');
    }

    let body: unknown;
    try { body = JSON.parse(stdout); } catch {
      throw new EngineError('INVALID_OUTPUT', 'The backtest worker returned malformed output');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      this.options.log?.('error', 'Backtest worker output failed validation', { issues: parsed.error.issues.slice(0, 5) });
      throw new EngineError('INVALID_OUTPUT', 'The backtest worker returned invalid output', parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`));
    }
    return parsed.data;
  }

  private async acquire(signal?: AbortSignal) {
    const max = this.options.maxConcurrent ?? SANDBOX_LIMITS.maxConcurrentRuns;
    if (this.active < max) { this.active++; return; }
    if (this.waiting.length >= (this.options.maxQueued ?? SANDBOX_LIMITS.maxQueuedRuns)) {
      throw new EngineError('BUSY', 'Too many backtests are running; try again shortly');
    }
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', onAbort); this.active++; resolve(); };
      const onAbort = () => { this.waiting = this.waiting.filter(w => w !== ready); reject(new EngineError('CANCELLED', 'Backtest cancelled')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(ready);
    });
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }

  async dispose() {
    const s = await this.sandbox?.catch(() => undefined);
    if (s) rmSync(s.dir, { recursive: true, force: true });
    this.sandbox = undefined;
  }
}

async function readLimited(stream: ReadableStream<Uint8Array>, max: number, onOverflow?: () => void): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) { onOverflow?.(); break; }
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Verifies the sandbox really isolates: runs a probe inside it that tries to read the environment,
 * reach the network and read the application directory. All three must fail.
 */
export async function verifySandboxIsolation(manager: BacktestWorkerManager, appDir: string) {
  const probe = `
    const out = { envKeys: Object.keys(process.env).filter(k => k !== 'PWD'), network: 'blocked', appDir: 'hidden' };
    try { await fetch('https://1.1.1.1', { signal: AbortSignal.timeout(2000) }); out.network = 'REACHABLE'; } catch {}
    try { require('fs').readdirSync(${JSON.stringify(appDir)}); out.appDir = 'VISIBLE'; } catch {}
    console.log(JSON.stringify(out));`;
  const { stdout } = await manager.probe(probe);
  const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { envKeys?: string[]; network?: string; appDir?: string };
  const problems = [
    ...(result.envKeys?.length ? [`environment visible: ${result.envKeys.join(',')}`] : []),
    ...(result.network !== 'blocked' ? ['network reachable'] : []),
    ...(result.appDir !== 'hidden' ? ['application directory visible'] : []),
  ];
  return { isolated: problems.length === 0, problems, result };
}
