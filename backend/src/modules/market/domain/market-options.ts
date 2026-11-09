// Market vocabulary shared across modules. Exchange-agnostic.

export const MARKET_TYPES = ['SPOT', 'PERPETUAL', 'FUTURES', 'FOREX'] as const;
export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;

export type MarketType = (typeof MARKET_TYPES)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];

export const isTimeframe = (value: string): value is Timeframe => (TIMEFRAMES as readonly string[]).includes(value);
