import { afterAll, describe, expect, test } from 'bun:test';
import { strategyDefinitionSchema } from '../../src/modules/strategies/domain/definition';
import { definitionToPine } from '../../src/modules/backtesting/engines/resin/definition-to-pine';
import { ResinEngine, toSandboxRequest } from '../../src/modules/backtesting/engines/resin/resin.engine';
import { BacktestWorkerManager } from '../../src/modules/backtesting/workers/backtest.worker-manager';
import { computeMetrics } from '../../src/modules/backtesting/utils/metrics';
import { TEST_SANDBOX_MODE } from '../helpers/test-app';
import { bars, definition, engineInput, pine, walk } from './fixtures';

const manager = new BacktestWorkerManager({ mode: TEST_SANDBOX_MODE });
const engine = new ResinEngine(manager);
afterAll(() => manager.dispose());
const always = [{ left: { type: 'PRICE' }, operator: 'GT', right: { type: 'VALUE', value: 0 } }];
const generated = (overrides: Record<string, unknown>) => definitionToPine('Risk regression', strategyDefinitionSchema.parse(definition({ entry: { conditions: always }, ...overrides })));

describe('generated strategy execution', () => {
  test('protects a long on its entry candle and does not count lows after the stop', async () => {
    const candles = bars([[100, 101, 99, 100], [100, 101, 90, 100]]);
    const r = await engine.run(engineInput(generated({ exit: { conditions: [], stopLossPercent: 5 } }), candles));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ entryPrice: '100', exitPrice: '95', profit: '-5', exitReason: 'Stop loss' });
    expect(r.trades[0]!.entryTime).toBe(r.trades[0]!.exitTime);
    expect(r.openPosition).toBeNull();
    expect(r.intrabarDrawdown?.amount).toBe('6'); // high 101 → stop95; low90 occurs after exit
  });

  test('protects short entry candles, including adverse movement before close', async () => {
    const r = await engine.run(engineInput(generated({ direction: 'SHORT', exit: { conditions: [], stopLossPercent: 5 } }), bars([[100, 101, 99, 100], [100, 110, 99, 100]])));
    expect(r.trades[0]).toMatchObject({ side: 'SHORT', entryPrice: '100', exitPrice: '105', profit: '-5' });
    expect(r.openPosition).toBeNull();
  });

  test('installs the entry bracket before intrabar margin checks on a fully sized short', async () => {
    const r = await engine.run(engineInput(generated({ direction: 'SHORT', exit: { conditions: [], stopLossPercent: 5 } }), bars([[100, 101, 99, 100], [100, 110, 99, 100]]), { positionSizing: { type: 'percent_of_equity', value: '100' } }));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: 'SHORT', quantity: '100', exitPrice: '105', profit: '-500', exitReason: 'Stop loss' });
  });

  test('fill callbacks cannot turn provisional indicator values into market exits', async () => {
    const source = generated({ exit: { conditions: [{ left: { type: 'PRICE' }, operator: 'LT', right: { type: 'VALUE', value: 105 } }], stopLossPercent: 50 } });
    const r = await engine.run(engineInput(source, bars([[110, 111, 109, 110], [100, 112, 99, 110], [110, 111, 109, 110]])));
    expect(r.trades).toEqual([]); // entry open100 would trigger an intrabar close; closed candles110 do not
    expect(r.openPosition?.entryTime).toBe(bars([[110, 111, 109, 110], [100, 112, 99, 110]])[1]!.openTime);
  });

  test('partial targets reserve slices with protective stops and reconcile total quantity', async () => {
    const source = generated({ exit: { conditions: [], stopLossPercent: 5, partialTakeProfits: [{ profitPercent: 5, quantityPercent: 50 }], takeProfitPercent: 10 } });
    const r = await engine.run(engineInput(source, bars([[100, 101, 99, 100], [100, 111, 99, 110]]), { positionSizing: { type: 'fixed_quantity', value: '2' } }));
    expect(r.trades.map(t => [t.quantity, t.exitPrice])).toEqual([['1', '105'], ['1', '110']]);
    expect(r.openPosition).toBeNull();
  });

  test('rounding partial targets to whole lots never leaves the remainder unprotected', async () => {
    const source = generated({ exit: { conditions: [], stopLossPercent: 5, partialTakeProfits: [{ profitPercent: 5, quantityPercent: 50 }], takeProfitPercent: 10 } });
    const r = await engine.run(engineInput(source, bars([[100, 101, 99, 100], [100, 101, 90, 100]]), { positionSizing: { type: 'fixed_quantity', value: '3' } }, { lotSize: '1' }));
    expect(r.trades.reduce((sum, t) => sum + Number(t.quantity), 0)).toBe(3);
    expect(r.trades.every(t => t.exitPrice === '95')).toBe(true);
    expect(r.openPosition).toBeNull();
  });

  test('trailing protection and pyramiding are available through validated definitions', async () => {
    const source = generated({ entry: { conditions: always, pyramiding: 2 }, exit: { conditions: [], trailingStop: { activationPercent: 2, offsetPercent: 3 } } });
    const r = await engine.run(engineInput(source, bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 110, 99, 108], [108, 109, 100, 101]])));
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades.some(t => t.exitReason === 'Trailing stop')).toBe(true);
    expect(() => strategyDefinitionSchema.parse(definition({ exit: { conditions: [], partialTakeProfits: [{ profitPercent: 5, quantityPercent: 60 }, { profitPercent: 10, quantityPercent: 60 }] } }))).toThrow();
    expect(() => strategyDefinitionSchema.parse(definition({ direction: 'SHORT', exit: { conditions: [], takeProfitPercent: 150 } }))).toThrow('prices positive');
  });
});

describe('warm-up and execution assumptions', () => {
  test('warms indicators without executing orders and returns only scored equity', async () => {
    const candles = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]);
    const source = pine('s = ta.sma(close, 3)\nif s > 0\n    strategy.entry("L", strategy.long)');
    const input = { ...engineInput(source, candles), tradingStartTime: candles[3]!.openTime };
    const r = await engine.run(input);
    expect(r.equity).toHaveLength(2);
    expect(r.openPosition?.entryTime).toBe(candles[4]!.openTime);
    const cold = await engine.run(engineInput(source, candles.slice(3)));
    expect(cold.openPosition).toBeNull();
  });

  test('appending future candles does not change previously computed strategy signals', async () => {
    const candles = walk(200, { seed: 19 });
    const source = definitionToPine('Prefix invariance', strategyDefinitionSchema.parse(definition()));
    const prefix = await engine.signals({ ...engineInput(source, candles.slice(0, 100)), bars: 100 });
    const extended = await engine.signals({ ...engineInput(source, candles), bars: 200 });
    expect(extended.bars.slice(0, 100)).toEqual(prefix.bars);
  });

  test('reports intrabar loss even when the bar closes at the entry price', async () => {
    const candles = bars([[100, 101, 99, 100], [100, 101, 90, 100]]);
    const r = await engine.run(engineInput(pine('if bar_index == 0\n    strategy.entry("L", strategy.long)'), candles));
    const metrics = computeMetrics(r, candles, '10000');
    expect(metrics.maxDrawdown).toBe('0');
    expect(metrics.intrabarMaxDrawdown).toBe('11'); // high101 then low90
    expect(metrics.intrabarDrawdownModel).toBe('ohlc_path');
  });

  test('a spread scenario worsens market fills without pretending it is observed bid/ask', async () => {
    const r = await engine.run(engineInput(pine('if bar_index == 0\n    strategy.entry("L", strategy.long)\nif bar_index == 1\n    strategy.close("L")'), bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]), { execution: { spreadTicks: 4 } }));
    expect(r.trades[0]).toMatchObject({ entryPrice: '100.02', exitPrice: '99.98', profit: '-0.04' });
    expect(r.executionAssumptions?.some(a => a.includes('Modeled spread'))).toBe(true);
  });

  test('entry participation uses only already closed volume and floors to the instrument lot', async () => {
    const candles = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]).map((c, i) => ({ ...c, volume: i === 0 ? '100' : '1000000' }));
    const r = await engine.run(engineInput(pine('if bar_index == 0\n    strategy.entry("L", strategy.long)'), candles, { positionSizing: { type: 'fixed_quantity', value: '1000' }, execution: { maxVolumeParticipationPercent: '5' } }, { lotSize: '2' }));
    expect(r.openPosition?.quantity).toBe('4');
    expect(r.executionAssumptions?.some(a => a.includes('remainder cancelled'))).toBe(true);
  });

  test('instrument point value affects P/L and symbol metadata reaches the interpreter', async () => {
    const source = pine('if syminfo.type == "futures" and syminfo.timezone == "Asia/Kolkata" and bar_index == 0\n    strategy.entry("L", strategy.long)\nif bar_index == 1\n    strategy.close("L")');
    const r = await engine.run(engineInput(source, bars([[100, 101, 99, 100], [100, 101, 99, 100], [102, 103, 101, 102]]), {}, { pointValue: '25', assetType: 'futures', timezone: 'Asia/Kolkata', session: '0915-1530:23456' }));
    expect(r.trades[0]?.profit).toBe('50');
  });

  test('refuses a price whose numeric conversion loses more than half a tick', () => {
    const candles = bars([[100, 101, 99, 100], [100, 101, 99, 100]]).map(c => ({ ...c, open: '9007199254740993' }));
    expect(() => toSandboxRequest(engineInput(pine(''), candles, {}, { tickSize: '0.01' }))).toThrow('precision');
  });
});
