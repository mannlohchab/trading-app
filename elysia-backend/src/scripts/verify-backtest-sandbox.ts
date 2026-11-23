// Fail before migrations or API startup if this deployment cannot isolate strategy execution.
import { EngineError } from '../modules/backtesting/engines/backtest-engine.interface';
import { BacktestWorkerManager, verifySandboxIsolation, type SandboxMode } from '../modules/backtesting/workers/backtest.worker-manager';

type Settings = { runJobs: boolean; sandbox: { mode: SandboxMode } };
type Manager = Pick<BacktestWorkerManager, 'probe' | 'dispose'>;

export async function verifyBacktestSandboxForStartup(
  settings: Settings,
  createManager: (mode: SandboxMode) => Manager = mode => new BacktestWorkerManager({ mode }),
) {
  if (!settings.runJobs) return;
  const manager = createManager(settings.sandbox.mode);
  try {
    const check = await verifySandboxIsolation(manager, new URL('../..', import.meta.url).pathname);
    if (!check.isolated) {
      throw new EngineError('SANDBOX_UNAVAILABLE', `Sandbox startup check failed: ${check.problems.join('; ')}`);
    }
  } finally {
    await manager.dispose();
  }
}

if (import.meta.main) {
  const { config } = await import('../config');
  await verifyBacktestSandboxForStartup(config.backtesting);
  console.log(config.backtesting.runJobs ? 'Backtest sandbox startup check passed' : 'Backtest sandbox startup check skipped: background jobs disabled');
}
