import { expect, test } from 'bun:test';
import { researchRanking, type ResearchObjective } from '../../src/modules/backtesting/backtesting.experiments';
import { evaluateWalkForward } from '../../src/modules/backtesting/research/walk-forward';
import { walk } from './fixtures';

const metrics = [
  { totalReturnPercent: '30', maxDrawdownPercent: '12', riskStatistics: { sharpe: '0.5', sortino: '1' } },
  { totalReturnPercent: '12', maxDrawdownPercent: '3', riskStatistics: { sharpe: '1.1', sortino: '1.5' } },
  { totalReturnPercent: '20', maxDrawdownPercent: '7', riskStatistics: { sharpe: '2.5', sortino: '2' } },
  { totalReturnPercent: '15', maxDrawdownPercent: '8', riskStatistics: { sharpe: '1.8', sortino: '3' } },
];

for (const [objective, selected] of Object.entries({ total_return: 0, min_drawdown: 1, sharpe: 2, sortino: 3 })) {
  test(`${objective} selects its requested training metric rather than the highest return`, async () => {
    const result = await evaluateWalkForward({ candles: walk(12), config: { trainBars: 4, testBars: 2, embargoBars: 1, stepBars: 4 }, candidates: [0, 1, 2, 3],
      evaluate: async ({ parameters, phase }) => {
        const data = metrics[parameters]!;
        const ranking = researchRanking(objective as ResearchObjective, data);
        return { score: phase === 'TEST' ? -999 : ranking.rankingScore, metrics: data };
      },
    });
    expect(result.windows).toHaveLength(2);
    expect(result.windows.every(w => w.selectedCandidate === selected)).toBe(true);
    expect(result.windows[0]!.outOfSample.score).toBe(-999);
    if (objective === 'min_drawdown') {
      expect(result.windows[0]!.training[selected]!.score).toBe(-3);
      expect(result.windows[0]!.training[selected]!.metrics.maxDrawdownPercent).toBe('3');
      expect(researchRanking('min_drawdown', metrics[selected]!)).toMatchObject({ rankingScore: -3, objectiveValue: 3, metric: 'maxDrawdownPercent' });
    }
  });
}

test('undefined and non-finite ratio objectives fail rather than ranking as zero', () => {
  for (const objective of ['sharpe', 'sortino'] as const) {
    expect(() => researchRanking(objective, { riskStatistics: { [objective]: null, reason: 'Flat equity has no return variation.' } })).toThrow('undefined');
    expect(() => researchRanking(objective, { riskStatistics: { [objective]: 'Infinity' } })).toThrow('non-finite');
    expect(() => researchRanking(objective, {})).toThrow('undefined');
  }
});
