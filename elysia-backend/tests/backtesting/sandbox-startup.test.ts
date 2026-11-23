import { describe, expect, mock, test } from 'bun:test';
import { verifySandboxIsolation } from '../../src/modules/backtesting/workers/backtest.worker-manager';
import { verifyBacktestSandboxForStartup } from '../../src/scripts/verify-backtest-sandbox';

const isolated = { envKeys: [], network: 'blocked', appDir: 'hidden' };
const manager = (stdout = JSON.stringify(isolated), exitCode: number | null = 0, stderr = '') => ({
  probe: mock(async () => ({ exitCode, stdout, stderr })),
  dispose: mock(async () => {}),
});

describe('sandbox isolation evidence', () => {
  test('reports the actual sandbox failure even if stdout claims success', async () => {
    await expect(verifySandboxIsolation(manager(JSON.stringify(isolated), 1, 'bwrap: permission denied'), '/app'))
      .rejects.toThrow('Sandbox isolation probe failed (exit 1): bwrap: permission denied');
    await expect(verifySandboxIsolation(manager('', null), '/app')).rejects.toThrow('exit signal');
  });

  test('rejects empty, malformed, missing or invalid evidence', async () => {
    for (const stdout of ['', 'not json']) {
      await expect(verifySandboxIsolation(manager(stdout), '/app')).rejects.toThrow('empty or malformed JSON');
    }
    for (const body of [null, {}, { network: 'blocked', appDir: 'hidden' }, { ...isolated, envKeys: '' }]) {
      await expect(verifySandboxIsolation(manager(JSON.stringify(body)), '/app')).rejects.toThrow('incomplete or invalid evidence');
    }
  });

  test('requires all three isolation properties', async () => {
    expect(await verifySandboxIsolation(manager(), '/app')).toMatchObject({ isolated: true, problems: [] });
    const check = await verifySandboxIsolation(manager(JSON.stringify({ envKeys: ['SECRET'], network: 'REACHABLE', appDir: 'VISIBLE' })), '/app');
    expect(check.isolated).toBe(false);
    expect(check.problems).toEqual(['environment visible: SECRET', 'network reachable', 'application directory visible']);
  });
});

describe('deployment startup gate', () => {
  test('skips workers only when this deployment explicitly disables jobs', async () => {
    const create = mock(() => manager());
    await verifyBacktestSandboxForStartup({ runJobs: false, sandbox: { mode: 'bwrap' } }, create);
    expect(create).not.toHaveBeenCalled();
  });

  test('disposes the worker after a successful probe', async () => {
    const worker = manager();
    await verifyBacktestSandboxForStartup({ runJobs: true, sandbox: { mode: 'bwrap' } }, () => worker);
    expect(worker.probe).toHaveBeenCalledTimes(1);
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  test('fails startup and disposes the worker when isolation cannot be established', async () => {
    const worker = manager('', 1, 'bwrap: namespace denied');
    await expect(verifyBacktestSandboxForStartup({ runJobs: true, sandbox: { mode: 'bwrap' } }, () => worker))
      .rejects.toThrow('namespace denied');
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  test('process mode cannot bypass the isolation requirement', async () => {
    const worker = manager(JSON.stringify({ ...isolated, appDir: 'VISIBLE' }));
    await expect(verifyBacktestSandboxForStartup({ runJobs: true, sandbox: { mode: 'process' } }, () => worker))
      .rejects.toThrow('application directory visible');
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });
});
