export type MarketSource = 'twelvedata' | 'binance';
export type MarketMetadata = { assetClass?: 'crypto' | 'forex'; baseCurrency?: string; currency?: string; pricePrecision?: number };

export type Instrument = MarketMetadata & {
  symbol: string;
  exchange: string;
  name: string;
  token?: string;
  segment?: string;
};

export type Quote = MarketMetadata & {
  stale?: boolean;
  marketOpen?: boolean;
  source?: MarketSource;
  asOf?: number;
  symbol: string;
  exchange: string;
  name: string;
  token?: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  sparkline?: number[];
};

export type Candle = {
  source?: MarketSource;
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Timeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d'
  | '1w'
  | '1M';

export type MarketStatus = 'PREOPEN' | 'OPEN' | 'CLOSED' | 'POST';

export type MarketOverview = {
  crypto?: Quote[];
  forex?: Quote[];
  availability?: { crypto: string; forex: string };
  status: MarketStatus;
  statusLabel: string;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  volatilityLabel: string;
  news: { id: string; title: string; source: string; publishedAt: string }[];
  events: { id: string; title: string; date: string }[];
  isDemo: boolean;
};

export interface MarketDataProvider {
  readonly name: string;
  readonly isDemo: boolean;
  search(query: string): Promise<Instrument[]>;
  quote(symbol: string, exchange?: string): Promise<Quote>;
  quotes(symbols: { symbol: string; exchange?: string }[]): Promise<Quote[]>;
  candles(symbol: string, timeframe: Timeframe, exchange?: string): Promise<Candle[]>;
  overview(): Promise<MarketOverview>;
  topMovers(): Promise<{ gainers: Quote[]; losers: Quote[]; active: Quote[] }>;
}
