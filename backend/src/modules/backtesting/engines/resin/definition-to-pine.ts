// Compiles our strategy definition (engine v1, what the AI assistant drafts) to a Pine Script v6
// strategy. Promoted unchanged from the proof of concept (poc/resin/definition-to-pine.ts); a
// regression test keeps the two outputs identical.
import type { Condition, StrategyDefinition } from '../../../strategies/domain/definition';

type Operand = Condition['left'] | Condition['right'];

export type PineOptions = {
  initialCapital?: number;
  /** Percent per side, e.g. 0.1 for Binance spot taker fees. */
  commissionPercent?: number;
  /** Ticks of slippage per fill. */
  slippageTicks?: number;
};

/** Strategy names reach a Pine string literal: allow only plain characters (no quotes, escapes or newlines). */
const safeTitle = (name: string) => name.replace(/[^A-Za-z0-9 ._()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Strategy';
const num = (v: number) => {
  if (!Number.isFinite(v)) throw new Error(`Non-finite number ${v}`);
  return String(v);
};

export function definitionToPine(name: string, def: StrategyDefinition, options: PineOptions = {}): string {
  const lines: string[] = [];
  const series = new Map<string, string>(); // operand key -> Pine variable

  // Every indicator is computed once per bar at the top level (Pine requires ta.* calls to run on
  // every bar for consistent history), then referenced by name in the conditions.
  const operand = (o: Operand): string => {
    switch (o.type) {
      case 'VALUE': return num(o.value);
      case 'PRICE': return 'close';
      case 'VOLUME': return 'volume';
    }
    const key = JSON.stringify(o);
    const existing = series.get(key);
    if (existing) return existing;
    const v = `s${series.size + 1}`;
    switch (o.type) {
      case 'SMA': lines.push(`${v} = ta.sma(close, ${num(o.period)})`); break;
      case 'EMA': lines.push(`${v} = ta.ema(close, ${num(o.period)})`); break;
      case 'RSI': lines.push(`${v} = ta.rsi(close, ${num(o.period)})`); break;
      case 'MACD': {
        lines.push(`[${v}_macd, ${v}_signal, ${v}_hist] = ta.macd(close, ${num(o.fast)}, ${num(o.slow)}, ${num(o.signal)})`);
        series.set(key, `${v}_${{ MACD: 'macd', SIGNAL: 'signal', HISTOGRAM: 'hist' }[o.line]}`);
        return series.get(key)!;
      }
      case 'BOLLINGER': {
        lines.push(`[${v}_mid, ${v}_up, ${v}_low] = ta.bb(close, ${num(o.period)}, ${num(o.stdDev)})`);
        series.set(key, `${v}_${{ MIDDLE: 'mid', UPPER: 'up', LOWER: 'low' }[o.band]}`);
        return series.get(key)!;
      }
    }
    series.set(key, v);
    return v;
  };

  // Each condition gets its own top-level variable: Pine v6 `and`/`or` short-circuit, so a
  // ta.crossover() inside them would skip bars and corrupt its history.
  let conditions = 0;
  const condition = (c: Condition) => {
    const l = operand(c.left), r = operand(c.right);
    const expr = {
      GT: `${l} > ${r}`,
      LT: `${l} < ${r}`,
      CROSSES_ABOVE: `ta.crossover(${l}, ${r})`,
      CROSSES_BELOW: `ta.crossunder(${l}, ${r})`,
    }[c.operator];
    const v = `c${++conditions}`;
    lines.push(`${v} = ${expr}`);
    return v;
  };

  const entry = def.entry.conditions.map(condition);
  const exit = def.exit.conditions.map(condition);
  lines.push(`entrySignal = ${entry.join(' and ')}`);
  lines.push(`exitSignal = ${exit.length ? exit.join(' or ') : 'false'}`);

  const body = [
    `if entrySignal and strategy.position_size == 0`,
    `    strategy.entry("Long", strategy.long)`,
    `if exitSignal and strategy.position_size > 0`,
    `    strategy.close("Long", comment="Exit rule")`,
  ];
  const { stopLossPercent: sl, takeProfitPercent: tp } = def.exit;
  if (sl !== undefined || tp !== undefined) {
    body.push(
      `if strategy.position_size > 0`,
      `    strategy.exit("Risk", "Long"${sl !== undefined ? `, stop=strategy.position_avg_price * ${num(1 - sl / 100)}` : ''}${tp !== undefined ? `, limit=strategy.position_avg_price * ${num(1 + tp / 100)}` : ''}, comment_loss="Stop loss", comment_profit="Take profit")`,
    );
  }

  const header = [
    '//@version=6',
    `// Generated from strategy definition engine v1: ${def.market.exchange}:${def.market.symbol} ${def.market.timeframe}`,
    `strategy("${safeTitle(name)}", overlay=true, initial_capital=${num(options.initialCapital ?? 10_000)}, ` +
      `default_qty_type=strategy.percent_of_equity, default_qty_value=${num(def.risk.positionSizePercent)}, ` +
      `commission_type=strategy.commission.percent, commission_value=${num(options.commissionPercent ?? 0.1)}, slippage=${num(options.slippageTicks ?? 0)})`,
  ];
  return [...header, '', ...lines, '', ...body, ''].join('\n');
}
