import type { DatasetCandle } from '../backtesting.types';

export type ResearchWindow = { id: number; trainStart: number; trainEnd: number; testStart: number; testEnd: number };
export type WalkForwardConfig = { trainBars: number; testBars: number; embargoBars?: number; stepBars?: number; anchored?: boolean };

/** Index intervals are half-open. Test intervals may never overlap. */
export function buildWalkForwardWindows(totalBars: number, config: WalkForwardConfig): ResearchWindow[] {
  const { trainBars, testBars, embargoBars = 0, stepBars = testBars, anchored = false } = config;
  for (const [key, value] of Object.entries({ totalBars, trainBars, testBars, embargoBars, stepBars })) {
    if (!Number.isSafeInteger(value) || value < (key === 'embargoBars' ? 0 : 1)) throw new Error(`${key} must be a valid positive integer (embargo may be zero).`);
  }
  if (stepBars < testBars) throw new Error('Overlapping out-of-sample windows would double-count returns.');
  const windows: ResearchWindow[] = [];
  for (let trainEnd = trainBars; trainEnd + embargoBars + testBars <= totalBars; trainEnd += stepBars) {
    windows.push({ id: windows.length, trainStart: anchored ? 0 : trainEnd - trainBars, trainEnd, testStart: trainEnd + embargoBars, testEnd: trainEnd + embargoBars + testBars });
    if (windows.length > 50) throw new Error('At most 50 walk-forward windows are permitted.');
  }
  if (!windows.length) throw new Error('Not enough candles for a training window, embargo and test window.');
  return windows;
}

export type ResearchEvaluation = { score: number; metrics: Record<string, unknown> };
export type ResearchEvaluator<P> = (input: {
  parameters: P; phase: 'TRAIN' | 'TEST' | 'SENSITIVITY'; windowId: number;
  /** Warm-up can precede evaluation but never includes any later observations. */
  warmup: DatasetCandle[]; candles: DatasetCandle[];
}) => Promise<ResearchEvaluation>;

function assertCandles(candles: DatasetCandle[]) {
  for (let i = 1; i < candles.length; i++) if (candles[i]!.openTime <= candles[i - 1]!.openTime || candles[i - 1]!.closeTime >= candles[i]!.openTime) throw new Error('Research candles must be chronological, unique and non-overlapping.');
}
function assertEvaluation(result: ResearchEvaluation) {
  if (!Number.isFinite(result.score)) throw new Error('Research objective must return a finite score.');
  return result;
}

/** Optimizes only on each training prefix; a selected parameter set is frozen before OOS evaluation. */
export async function evaluateWalkForward<P>(input: {
  candles: DatasetCandle[]; config: WalkForwardConfig; candidates: P[]; evaluate: ResearchEvaluator<P>;
  warmupBars?: number; objective?: 'maximize' | 'minimize';
}) {
  assertCandles(input.candles);
  if (!input.candidates.length || input.candidates.length > 20) throw new Error('Supply 1 to 20 parameter candidates.');
  const windows = buildWalkForwardWindows(input.candles.length, input.config);
  if (windows.length * (input.candidates.length + 1) > 200) throw new Error('Research run exceeds the 200-evaluation limit.');
  const warmupBars = input.warmupBars ?? 0;
  if (!Number.isSafeInteger(warmupBars) || warmupBars < 0) throw new Error('Warm-up must be a non-negative integer.');
  const results = [];
  for (const window of windows) {
    const training = [];
    for (const [candidateIndex, parameters] of input.candidates.entries()) {
      const result = assertEvaluation(await input.evaluate({ parameters: structuredClone(parameters), phase: 'TRAIN', windowId: window.id,
        warmup: input.candles.slice(Math.max(0, window.trainStart - warmupBars), window.trainStart),
        candles: input.candles.slice(window.trainStart, window.trainEnd),
      }));
      training.push({ candidateIndex, ...result });
    }
    const direction = input.objective === 'minimize' ? 1 : -1;
    const selected = [...training].sort((a, b) => direction * (a.score - b.score) || a.candidateIndex - b.candidateIndex)[0]!;
    const parameters = structuredClone(input.candidates[selected.candidateIndex]!);
    const outOfSample = assertEvaluation(await input.evaluate({ parameters, phase: 'TEST', windowId: window.id,
      warmup: input.candles.slice(Math.max(0, window.testStart - warmupBars), window.testStart),
      candles: input.candles.slice(window.testStart, window.testEnd),
    }));
    results.push({ window, selectedCandidate: selected.candidateIndex, parameters: input.candidates[selected.candidateIndex]!, training, outOfSample,
      trainRange: { start: input.candles[window.trainStart]!.openTime, end: input.candles[window.trainEnd - 1]!.closeTime + 1 },
      testRange: { start: input.candles[window.testStart]!.openTime, end: input.candles[window.testEnd - 1]!.closeTime + 1 },
    });
  }
  return {
    windows: results,
    evaluatedCandidates: input.candidates.length,
    warnings: ['Training scores are for parameter selection, not expected returns.', 'Each test window starts a new simulated account; window returns are not a continuous portfolio equity curve.', 'Repeatedly inspecting out-of-sample results makes them part of model selection; reserve a final untouched holdout.'],
  };
}

/** Deliberately reports the whole neighborhood instead of returning only its best backtest. */
export async function compareParameterVariants<P>(input: { candles: DatasetCandle[]; candidates: P[]; evaluate: ResearchEvaluator<P>; warmup?: DatasetCandle[] }) {
  assertCandles(input.candles);
  if (!input.candidates.length || input.candidates.length > 20) throw new Error('Supply 1 to 20 parameter candidates.');
  if (input.warmup?.length && input.candles.length && input.warmup.at(-1)!.closeTime >= input.candles[0]!.openTime) throw new Error('Warm-up must end before the evaluated range.');
  const results = [];
  for (const [index, parameters] of input.candidates.entries()) results.push({ index, parameters,
    ...assertEvaluation(await input.evaluate({ parameters: structuredClone(parameters), phase: 'SENSITIVITY', windowId: 0, warmup: input.warmup ?? [], candles: input.candles })),
  });
  const scores = results.map(r => r.score).sort((a, b) => a - b);
  const middle = Math.floor(scores.length / 2);
  return { results, minimumScore: scores[0]!, maximumScore: scores.at(-1)!, medianScore: scores.length % 2 ? scores[middle]! : (scores[middle - 1]! + scores[middle]!) / 2,
    warnings: ['Parameter sensitivity uses the same history for every candidate and is not out-of-sample validation.'] };
}
