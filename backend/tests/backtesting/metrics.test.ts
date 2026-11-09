import { describe, expect, test } from 'bun:test';
import type { EngineResult, EngineTrade } from '../../src/modules/backtesting/backtesting.types';
import { dec, toUnits } from '../../src/modules/backtesting/utils/decimal';
import { computeMetrics, downsampleEquity } from '../../src/modules/backtesting/utils/metrics';
import { bars } from './fixtures';

describe('decimal arithmetic', () => {
  test('is exact where floats are not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(dec.add('0.1', '0.2')).toBe('0.3');
    expect(dec.sum(Array(10).fill('0.1'))).toBe('1');
    expect(dec.mul('73886.01', '0.00001')).toBe('0.7388601');
    expect(dec.div('10', '3')).toBe('3.333333333333');
    expect(dec.percent('-245.83', '10000')).toBe('-2.4583');
    expect(dec.round('1.234567895', 8)).toBe('1.2345679');
    expect(dec.roundToStep(dec.from(81269.58 + 0.02), '0.01')).toBe('81269.6'); // float noise removed
    expect(dec.roundToStep('0.123456789', '0.00001')).toBe('0.12346');
    expect(dec.roundToStep('7.3', '0.5')).toBe('7.5');
    expect(dec.from(-0.0000000000004)).toBe('0');
    expect(dec.from(123456789012345.678)).toBe('123456789012345.671875'); // the float's exact binary value, not a rounding artefact
  });
  test('rejects non-decimals and division by zero', () => {
    expect(() => toUnits('1e5')).toThrow();
    expect(() => toUnits('abc')).toThrow();
    expect(() => dec.div('1', '0')).toThrow();
  });
});

const trade = (profit: string, commission = '0', entryTime = 0, exitTime = 3_600_000): EngineTrade => ({
  side: 'LONG', quantity: '1', entryTime, exitTime, entryPrice: '100', exitPrice: '101', profit, profitPercent: '1',
  commission, maxRunup: '0', maxDrawdown: '0', entryId: 'L', exitId: 'L', exitReason: 'L',
});
const result = (trades: EngineTrade[], equity: string[], openPosition: EngineResult['openPosition'] = null): EngineResult => ({
  engine: { name: 'resin', version: '0.3.0', revision: 'x' }, trades, equity, realizedPnl: dec.sum(trades.map(t => t.profit)), openPosition, durationMs: 1,
});
const candles = bars(Array.from({ length: 5 }, (_, i) => [100 + i, 101 + i, 99 + i, 100 + i] as [number, number, number, number]));

describe('metrics', () => {
  test('zero trades: no divide-by-zero, undefined ratios are null', () => {
    const m = computeMetrics(result([], ['10000', '10000', '10000', '10000', '10000']), candles, '10000');
    expect(m).toMatchObject({
      totalTrades: 0, winRatePercent: null, profitFactor: null, averageTrade: null, averageWinningTrade: null,
      largestLosingTrade: null, averageTradeDurationMs: null, netProfit: '0', totalReturnPercent: '0', maxDrawdown: '0', exposurePercent: '0',
    });
  });

  test('sums, ratios and drawdown use exact decimals', () => {
    const m = computeMetrics(result(
      [trade('0.1', '0.05'), trade('0.2', '0.05'), trade('-0.15', '0.05', 0, 7_200_000)],
      ['10000', '10000.1', '9999.8', '10000.15', '10000.15'],
    ), candles, '10000');
    expect(m).toMatchObject({
      totalTrades: 3, winningTrades: 2, losingTrades: 1, winRatePercent: '66.6667',
      grossProfit: '0.3', grossLoss: '-0.15', netProfit: '0.15', totalCommission: '0.15',
      profitFactor: '2', averageTrade: '0.05', averageWinningTrade: '0.15', averageLosingTrade: '-0.15',
      largestWinningTrade: '0.2', largestLosingTrade: '-0.15', averageTradeDurationMs: 4_800_000,
      maxDrawdown: '0.3', unrealizedProfit: '0', totalReturnPercent: '0.0015',
    });
    expect(m.maxDrawdownPercent).toBe(dec.round(dec.percent('0.3', '10000.1'), 8));
  });

  test('flat at the end: unrealized P/L is exactly zero, final equity is capital + realized', () => {
    const m = computeMetrics(result([trade('-399.63615436')], ['10000', '9800', '9700', '9650', '9600.36384563']), candles, '10000');
    expect(m).toMatchObject({ unrealizedProfit: '0', finalEquity: '9600.36384564', netProfit: '-399.63615436' });
  });

  test('profit factor is null (not infinite) without losses', () => {
    expect(computeMetrics(result([trade('5')], ['10000', '10005', '10005', '10005', '10005']), candles, '10000').profitFactor).toBeNull();
  });

  test('an open position is unrealized P/L and its entry fee counts as commission', () => {
    const open = { side: 'LONG' as const, quantity: '1', averagePrice: '100', entryCommission: '0.1', entryTime: candles[2]!.openTime };
    const m = computeMetrics(result([trade('1', '0.2')], ['10000', '10001', '10000.9', '10002.9', '10003.9'], open), candles, '10000');
    expect(m).toMatchObject({ netProfit: '1', unrealizedProfit: '2.9', totalCommission: '0.3', finalEquity: '10003.9', totalReturnPercent: '0.039' });
    expect(Number(m.exposurePercent)).toBeGreaterThan(0);
  });

  test('downsampling keeps the extremes so drawdowns stay visible', () => {
    const times = Array.from({ length: 10_000 }, (_, i) => i);
    const equity = times.map(i => (i === 5_000 ? '1' : '100'));
    const points = downsampleEquity(times, equity, 200);
    expect(points.length).toBeLessThanOrEqual(200);
    expect(points.some(p => p.equity === '1')).toBe(true);
    expect(points[0]!.time).toBe(0);
    expect(points.at(-1)!.time).toBe(9_999);
  });
});
