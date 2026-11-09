import { ProviderUnavailableError } from '../../src/modules/market/application/errors';
import type { FeedEvent, FeedStatus, LiveFeed, MarketDataProvider } from '../../src/modules/market/application/ports';
import type { Timeframe } from '../../src/modules/market/domain/market-options';
import type { Candle, Instrument, Ticker, Topic } from '../../src/modules/market/domain/types';

export const instrument = (symbol: string, baseAsset: string, quoteAsset: string, extra: Partial<Instrument> = {}): Instrument => ({
  exchange: 'BINANCE', symbol, baseAsset, quoteAsset, marketType: 'SPOT',
  pricePrecision: 2, quantityPrecision: 5, tickSize: '0.01', stepSize: '0.00001', isActive: true, metadata: { minNotional: '5' }, ...extra,
});

export const ticker = (symbol: string, lastPrice: string, changePercent: string, quoteVolume: string): Ticker => ({
  exchange: 'BINANCE', symbol, lastPrice, priceChange: '0', priceChangePercent: changePercent, openPrice: lastPrice,
  highPrice: lastPrice, lowPrice: lastPrice, volume: '1', quoteVolume, bidPrice: null, askPrice: null, time: 1_700_000_000_000,
});

export const candle = (openTime: number, close: string, isClosed = true, minutes = 1): Candle => ({
  openTime, closeTime: openTime + minutes * 60_000 - 1, open: close, high: close, low: close, close,
  volume: '10', quoteVolume: '100', trades: 5, isClosed,
});

export class FakeProvider implements MarketDataProvider {
  readonly exchange = 'BINANCE';
  instruments: Instrument[] = [
    instrument('BTCUSDT', 'BTC', 'USDT'),
    instrument('ETHUSDT', 'ETH', 'USDT'),
    instrument('SOLUSDT', 'SOL', 'USDT'),
    instrument('ETHBTC', 'ETH', 'BTC'),
  ];
  tickers: Ticker[] = [
    ticker('BTCUSDT', '73886.01', '-2.7', '1000000000'),
    ticker('ETHUSDT', '2093.12', '4.2', '500000000'),
    ticker('SOLUSDT', '180.5', '9.1', '90000000'),
    ticker('ETHBTC', '0.0283', '1.0', '900'),
    ticker('DELISTEDUSDT', '1', '0', '1'),
  ];
  candles: Candle[] = [];
  down = false;
  calls = { instruments: 0, tickers: 0, candles: 0 };

  async fetchInstruments() { this.calls.instruments++; this.guard(); return this.instruments; }
  async fetchTickers() { this.calls.tickers++; this.guard(); return this.tickers; }
  async fetchCandles(_symbol: string, _timeframe: Timeframe, { limit }: { limit: number }) {
    this.calls.candles++; this.guard(); return this.candles.slice(-limit);
  }
  private guard() { if (this.down) throw new ProviderUnavailableError('fake exchange down'); }
}

export class FakeFeed implements LiveFeed {
  readonly exchange = 'BINANCE';
  status: FeedStatus = 'idle';
  topics: Topic[] = [];
  private events: ((e: FeedEvent) => void)[] = [];
  private statuses: ((s: FeedStatus) => void)[] = [];
  setTopics(topics: Topic[]) { this.topics = topics; }
  onEvent(l: (e: FeedEvent) => void) { this.events.push(l); }
  onStatus(l: (s: FeedStatus) => void) { this.statuses.push(l); }
  stop() { this.topics = []; }
  emit(event: FeedEvent) { this.events.forEach(l => l(event)); }
  setStatus(status: FeedStatus) { this.status = status; this.statuses.forEach(l => l(status)); }
}
