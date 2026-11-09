// The engine boundary. The rest of the module only knows these types; Resin (or a future engine)
// lives behind an implementation of BacktestEngine.
import type { EngineIdentity, EngineInput, EngineResult } from '../backtesting.types';

export type SignalInput = Omit<EngineInput, 'settings'> & { settings: EngineInput['settings']; /** Latest bars to report. */ bars: number };
export type SignalSeries = { engine: EngineIdentity; bars: { openTime: number; entry: boolean; exit: boolean }[]; durationMs: number };

export interface BacktestEngine {
  readonly identity: EngineIdentity;
  /** Runs one backtest in isolation. Throws EngineError for expected failures. */
  run(input: EngineInput, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<EngineResult>;
}

/**
 * Evaluates a strategy's own entry/exit signals on the latest closed candles (live paper trading).
 * Same engine, script and indicators as BacktestEngine; only the output differs.
 */
export interface StrategySignalEngine {
  readonly identity: EngineIdentity;
  signals(input: SignalInput, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<SignalSeries>;
}

export type EngineErrorCode =
  | 'COMPILE_ERROR'
  | 'NOT_A_STRATEGY'
  | 'RUNTIME_ERROR'
  | 'SCRIPT_HALTED'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'RESOURCE_LIMIT'
  | 'INVALID_OUTPUT'
  | 'CANCELLED'
  | 'SANDBOX_UNAVAILABLE'
  | 'BUSY';

/** Codes worth retrying: the same input may succeed later. Everything else is deterministic. */
export const RETRYABLE_ENGINE_ERRORS: ReadonlySet<EngineErrorCode> = new Set(['SANDBOX_UNAVAILABLE', 'BUSY']);

export class EngineError extends Error {
  constructor(readonly code: EngineErrorCode, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'EngineError';
  }
  get retryable() {
    return RETRYABLE_ENGINE_ERRORS.has(this.code);
  }
}
