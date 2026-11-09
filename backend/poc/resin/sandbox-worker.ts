// Worker entry: runs one backtest and posts the result back. Spawned per job by sandbox.ts.
import { runPineBacktest, type BacktestInput } from './pine-backtest';

declare const self: Worker;
self.onmessage = (event: MessageEvent<BacktestInput>) => {
  try {
    self.postMessage(runPineBacktest(event.data));
  } catch (error) {
    self.postMessage({ ok: false, stage: 'runtime', errors: [error instanceof Error ? error.message : String(error)] });
  }
};
