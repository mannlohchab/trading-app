// Engine semantics through the real sandbox (ResinEngine → worker process → Resin).
import { afterAll, describe, expect, test } from 'bun:test';
import { EngineError } from '../../src/modules/backtesting/engines/backtest-engine.interface';
import { ResinEngine } from '../../src/modules/backtesting/engines/resin/resin.engine';
import { BacktestWorkerManager } from '../../src/modules/backtesting/workers/backtest.worker-manager';
import { TEST_SANDBOX_MODE } from '../helpers/test-app';
import { bars, engineInput, pine, walk } from './fixtures';

const manager = new BacktestWorkerManager({ mode: TEST_SANDBOX_MODE });
const engine = new ResinEngine(manager);
afterAll(() => manager.dispose());

// Bar opens: 100, 100, 102, 105, 110, 108, … (entry signal on bar 1 → fills at bar 2's open = 102)
const path = bars([
  [100, 101, 99, 100], [100, 101, 99, 101], [102, 104, 101, 103], [105, 106, 104, 105],
  [110, 111, 109, 110], [108, 109, 107, 108], [108, 109, 107, 108], [108, 109, 107, 108],
]);
const openAt1CloseAt3 = (side = 'strategy.long') => pine(`if bar_index == 1\n    strategy.entry("P", ${side})\nif bar_index == 3\n    strategy.close("P")`);
const n = (v: string | null | undefined) => Number(v);
const engineError = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as EngineError; } throw new Error('expected EngineError'); };

describe('positions', () => {
  test('long: buy at the next open, sell at the next open after the exit signal', async () => {
    const r = await engine.run(engineInput(openAt1CloseAt3(), path));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: 'LONG', quantity: '1', entryPrice: '102', exitPrice: '110', profit: '8', commission: '0' });
    expect(r.trades[0]!.entryTime).toBe(path[2]!.openTime);
    expect(r.equity).toHaveLength(path.length);
  });

  test('short: profits when price falls, loses when it rises', async () => {
    const r = await engine.run(engineInput(openAt1CloseAt3('strategy.short'), path));
    expect(r.trades[0]).toMatchObject({ side: 'SHORT', entryPrice: '102', exitPrice: '110', profit: '-8' });
  });

  test('zero-trade strategies run normally', async () => {
    const r = await engine.run(engineInput(pine('if close < 0\n    strategy.entry("L", strategy.long)'), path));
    expect(r.trades).toEqual([]);
    expect(r.openPosition).toBeNull();
    expect(r.equity.every(e => e === '10000')).toBe(true);
  });
});

describe('costs and symbol grids', () => {
  test('commission is charged on entry and exit value', async () => {
    const r = await engine.run(engineInput(openAt1CloseAt3(), path, { commissionPercent: '0.1' }));
    expect(n(r.trades[0]!.commission)).toBeCloseTo(0.001 * 102 + 0.001 * 110, 10); // 0.212
    expect(n(r.trades[0]!.profit)).toBeCloseTo(8 - 0.212, 10);
  });

  test('slippage moves both fills against the trade by N ticks', async () => {
    const r = await engine.run(engineInput(openAt1CloseAt3(), path, { slippageTicks: 5 }));
    expect(r.trades[0]).toMatchObject({ entryPrice: '102.05', exitPrice: '109.95' });
    expect(n(r.trades[0]!.profit)).toBeCloseTo(7.9, 10);
  });

  test('tick sizes map exactly onto the pricescale/minmove grid', async () => {
    const { tickGrid } = await import('../../src/modules/backtesting/engines/resin/resin.engine');
    expect(tickGrid('0.01')).toEqual({ pricescale: 100, minmove: 1 });
    expect(tickGrid('0.5')).toEqual({ pricescale: 10, minmove: 5 });
    expect(tickGrid('0.00000001')).toEqual({ pricescale: 100_000_000, minmove: 1 });
    expect(tickGrid('0.0025')).toEqual({ pricescale: 10_000, minmove: 25 });
    expect(tickGrid('1')).toEqual({ pricescale: 1, minmove: 1 });
  });

  test('tiny tick sizes (e.g. 0.00000001) run', async () => {
    const tiny = bars(Array.from({ length: 8 }, (_, i) => [0.00001 + i * 1e-7, 0.000011 + i * 1e-7, 0.0000095 + i * 1e-7, 0.00001 + i * 1e-7] as [number, number, number, number]));
    const r = await engine.run(engineInput(openAt1CloseAt3(), tiny, { slippageTicks: 1 }, { tickSize: '0.00000001' }));
    expect(r.trades).toHaveLength(1);
  });

  test('tick size sets the slippage step', async () => {
    const r = await engine.run(engineInput(openAt1CloseAt3(), path, { slippageTicks: 2 }, { tickSize: '0.5' }));
    expect(r.trades[0]).toMatchObject({ entryPrice: '103', exitPrice: '109', profit: '6' });
  });

  test('lot size: percent-of-equity orders are floored to whole lots', async () => {
    const r = await engine.run(engineInput(openAt1CloseAt3(), path, { positionSizing: { type: 'percent_of_equity', value: '50' } }, { lotSize: '0.1' }));
    const qty = n(r.trades[0]!.quantity);
    expect(Number.isInteger(Math.round(qty * 10) / 1)).toBe(true);
    expect((qty * 10) % 1).toBeCloseTo(0, 9);
    expect(qty * 101).toBeLessThanOrEqual(5000); // never more than the 50% budget (sized on the signal close)
    expect(qty * 101).toBeGreaterThan(5000 - 101 * 0.1); // within one lot of it
  });
});

describe('exits', () => {
  const drop = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99.5, 100], [99, 99, 94, 95], [95, 96, 94, 95]]);
  const rise = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99.5, 100], [101, 111, 100, 110], [110, 111, 109, 110]]);
  const bracket = pine('if bar_index == 1\n    strategy.entry("L", strategy.long)\nstrategy.exit("B", "L", stop=95, limit=110, comment_loss="SL", comment_profit="TP")');

  test('stop loss fills at the stop price', async () => {
    const r = await engine.run(engineInput(bracket, drop));
    expect(r.trades[0]).toMatchObject({ entryPrice: '100', exitPrice: '95', profit: '-5', exitReason: 'SL' });
  });

  test('take profit fills at the limit price', async () => {
    const r = await engine.run(engineInput(bracket, rise));
    expect(r.trades[0]).toMatchObject({ entryPrice: '100', exitPrice: '110', profit: '10', exitReason: 'TP' });
  });

  test('trailing stop exits below the peak after a reversal', async () => {
    const up = Array.from({ length: 10 }, (_, i) => 100 + i * 2);
    const down = Array.from({ length: 10 }, (_, i) => 118 - i * 2);
    const candles = bars([...up, ...down].map(c => [c, c + 1, c - 1, c] as [number, number, number, number]));
    // trail_points/trail_offset are in ticks (0.01): activate 2.00 above entry, trail 3.00 behind.
    const r = await engine.run(engineInput(pine('if bar_index == 0\n    strategy.entry("L", strategy.long)\nstrategy.exit("T", "L", trail_points=200, trail_offset=300, comment_trailing="Trail")'), candles));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.exitReason).toBe('Trail');
    expect(n(r.trades[0]!.exitPrice)).toBeCloseTo(119 - 3, 6); // peak high 119, 3.00 offset
    expect(n(r.trades[0]!.exitPrice)).toBeLessThan(n(r.trades[0]!.entryPrice) + n(r.trades[0]!.maxRunup));
  });

  test('pyramiding adds entries up to the limit; each is its own trade', async () => {
    const r = await engine.run(engineInput(pine('if bar_index <= 4\n    strategy.entry("L", strategy.long)\nif bar_index == 6\n    strategy.close("L")', ', pyramiding=3'), walk(10, { seed: 3 })));
    expect(r.trades).toHaveLength(3);
    expect(new Set(r.trades.map(t => t.exitTime)).size).toBe(1);
  });

  test('partial exits split one entry into separate trades', async () => {
    const candles = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99.5, 100], [101, 106, 100, 105], [105, 106, 104, 105], [105, 106, 104, 105], [107, 108, 106, 107]]);
    const r = await engine.run(engineInput(pine('if bar_index == 1\n    strategy.entry("L", strategy.long, qty=2)\nstrategy.exit("Half", "L", qty_percent=50, limit=105)\nif bar_index == 5\n    strategy.close("L")'), candles));
    expect(r.trades.map(t => [t.quantity, t.exitPrice])).toEqual([['1', '105'], ['1', '107']]);
  });
});

describe('script errors', () => {
  test('invalid Pine is a compile error with the compiler messages', async () => {
    const e = await engineError(engine.run(engineInput('//@version=6\nstrategy("x"\nif', path)));
    expect(e.code).toBe('COMPILE_ERROR');
    expect(e.details.length).toBeGreaterThan(0);
  });
  test('indicators are rejected; scripts may halt themselves', async () => {
    expect((await engineError(engine.run(engineInput('//@version=6\nindicator("x")\nplot(close)', path)))).code).toBe('NOT_A_STRATEGY');
    expect((await engineError(engine.run(engineInput(pine('if bar_index == 3\n    runtime.error("stop")'), path)))).code).toBe('SCRIPT_HALTED');
  });
  test('unsupported Pine versions are compile errors', async () => {
    expect((await engineError(engine.run(engineInput('//@version=4\nstrategy("v4")\nif crossover(sma(close, 2), sma(close, 3))\n    strategy.entry("L", true)', path)))).code).toBe('COMPILE_ERROR');
  });
});
