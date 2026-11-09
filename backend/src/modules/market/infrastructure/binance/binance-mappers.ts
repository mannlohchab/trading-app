// Binance payload → domain types. Spot only for now.
import { decimalPlaces, normalizeDecimal } from '../../domain/rules';
import type { Candle, Instrument, Ticker } from '../../domain/types';

export const BINANCE = 'BINANCE';

type Filter = { filterType: string; [key: string]: unknown };
export type BinanceSymbol = {
  symbol: string; status: string; baseAsset: string; quoteAsset: string;
  isSpotTradingAllowed?: boolean; baseAssetPrecision?: number; quoteAssetPrecision?: number; filters?: Filter[];
};

const dec = (v: unknown) => normalizeDecimal(String(v));
const optionalDec = (v: unknown) => (v === undefined || v === null || v === '' ? null : dec(v));
const positiveOrNull = (v: string | null) => (v !== null && Number(v) > 0 ? v : null);

export function toInstrument(s: BinanceSymbol): Instrument | null {
  if (s.status !== 'TRADING' || s.isSpotTradingAllowed === false) return null;
  const filter = (type: string) => s.filters?.find(f => f.filterType === type);
  const tickSize = positiveOrNull(optionalDec(filter('PRICE_FILTER')?.tickSize));
  const lot = filter('LOT_SIZE');
  const stepSize = positiveOrNull(optionalDec(lot?.stepSize));
  const notional = filter('NOTIONAL') ?? filter('MIN_NOTIONAL');
  return {
    exchange: BINANCE,
    symbol: s.symbol,
    baseAsset: s.baseAsset,
    quoteAsset: s.quoteAsset,
    marketType: 'SPOT',
    pricePrecision: tickSize ? decimalPlaces(tickSize) : null,
    quantityPrecision: stepSize ? decimalPlaces(stepSize) : null,
    tickSize,
    stepSize,
    isActive: true,
    metadata: {
      minQuantity: optionalDec(lot?.minQty),
      maxQuantity: optionalDec(lot?.maxQty),
      minNotional: optionalDec(notional?.minNotional),
      baseAssetPrecision: s.baseAssetPrecision ?? null,
      quoteAssetPrecision: s.quoteAssetPrecision ?? null,
    },
  };
}

/** REST /api/v3/ticker/24hr item. */
export type BinanceRestTicker = {
  symbol: string; priceChange: string; priceChangePercent: string; lastPrice: string; bidPrice?: string; askPrice?: string;
  openPrice: string; highPrice: string; lowPrice: string; volume: string; quoteVolume: string; closeTime: number;
};
export const tickerFromRest = (t: BinanceRestTicker): Ticker => ({
  exchange: BINANCE,
  symbol: t.symbol,
  lastPrice: dec(t.lastPrice),
  priceChange: dec(t.priceChange),
  priceChangePercent: dec(t.priceChangePercent),
  openPrice: dec(t.openPrice),
  highPrice: dec(t.highPrice),
  lowPrice: dec(t.lowPrice),
  volume: dec(t.volume),
  quoteVolume: dec(t.quoteVolume),
  bidPrice: optionalDec(t.bidPrice),
  askPrice: optionalDec(t.askPrice),
  time: t.closeTime,
});

/** WebSocket <symbol>@ticker event. */
export type BinanceWsTicker = { e: '24hrTicker'; E: number; s: string; p: string; P: string; c: string; b?: string; a?: string; o: string; h: string; l: string; v: string; q: string; C?: number };
export const tickerFromStream = (t: BinanceWsTicker): Ticker => ({
  exchange: BINANCE,
  symbol: t.s,
  lastPrice: dec(t.c),
  priceChange: dec(t.p),
  priceChangePercent: dec(t.P),
  openPrice: dec(t.o),
  highPrice: dec(t.h),
  lowPrice: dec(t.l),
  volume: dec(t.v),
  quoteVolume: dec(t.q),
  bidPrice: optionalDec(t.b),
  askPrice: optionalDec(t.a),
  time: t.C ?? t.E,
});

/** REST /api/v3/klines row: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, ...]. */
export type BinanceKlineRow = [number, string, string, string, string, string, number, string, number, ...unknown[]];
export const candleFromRest = (r: BinanceKlineRow, now: number): Candle => ({
  openTime: r[0], closeTime: r[6],
  open: dec(r[1]), high: dec(r[2]), low: dec(r[3]), close: dec(r[4]), volume: dec(r[5]),
  quoteVolume: optionalDec(r[7]), trades: typeof r[8] === 'number' ? r[8] : null,
  isClosed: r[6] < now,
});

/** WebSocket <symbol>@kline_<interval> event. */
export type BinanceWsKline = { e: 'kline'; E: number; s: string; k: { t: number; T: number; i: string; o: string; c: string; h: string; l: string; v: string; n: number; x: boolean; q: string } };
export const candleFromStream = ({ k }: BinanceWsKline): Candle => ({
  openTime: k.t, closeTime: k.T,
  open: dec(k.o), high: dec(k.h), low: dec(k.l), close: dec(k.c), volume: dec(k.v),
  quoteVolume: optionalDec(k.q), trades: k.n, isClosed: k.x,
});
