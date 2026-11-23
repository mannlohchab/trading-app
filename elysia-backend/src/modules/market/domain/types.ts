import type { MarketType, Timeframe } from './market-options';

/** Exact decimal as a string (e.g. "73886.01"). Never convert prices or sizes to JS numbers for math. */
export type Decimal = string;

export type Instrument = {
  exchange: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  marketType: MarketType;
  pricePrecision: number | null;
  quantityPrecision: number | null;
  tickSize: Decimal | null;
  stepSize: Decimal | null;
  isActive: boolean;
  /** Exchange-specific extras (min order size, min notional, ...). */
  metadata: Record<string, unknown>;
};

/** Rolling 24-hour statistics. */
export type Ticker = {
  exchange: string;
  symbol: string;
  lastPrice: Decimal;
  priceChange: Decimal;
  priceChangePercent: Decimal;
  openPrice: Decimal;
  highPrice: Decimal;
  lowPrice: Decimal;
  volume: Decimal;
  quoteVolume: Decimal;
  bidPrice: Decimal | null;
  askPrice: Decimal | null;
  /** Unix ms of the statistics. */
  time: number;
};

/** Times are Unix milliseconds; `closeTime` is the last millisecond of the candle. */
export type Candle = {
  openTime: number;
  closeTime: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
  quoteVolume: Decimal | null;
  trades: number | null;
  isClosed: boolean;
};

export type TickerTopic = { kind: 'ticker'; exchange: string; symbol: string };
export type CandleTopic = { kind: 'candles'; exchange: string; symbol: string; timeframe: Timeframe };
/** A live-data channel a client can subscribe to. */
export type Topic = TickerTopic | CandleTopic;
