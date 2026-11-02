import type {
  Candle,
  Instrument,
  MarketDataProvider,
  MarketOverview,
  MarketStatus,
  Quote,
  Timeframe,
} from './types';

type DemoInstrument = Instrument & {
  basePrice: number;
  volatility: number;
};

const INSTRUMENTS: DemoInstrument[] = [
  { symbol: 'NIFTY', exchange: 'NSE', name: 'Nifty 50', token: '99926000', basePrice: 24450, volatility: 0.006, segment: 'INDEX' },
  { symbol: 'BANKNIFTY', exchange: 'NSE', name: 'Nifty Bank', token: '99926009', basePrice: 51200, volatility: 0.008, segment: 'INDEX' },
  { symbol: 'SENSEX', exchange: 'BSE', name: 'S&P BSE Sensex', token: '1', basePrice: 80420, volatility: 0.005, segment: 'INDEX' },
  { symbol: 'FINNIFTY', exchange: 'NSE', name: 'Nifty Financial Services', token: '99926037', basePrice: 23480, volatility: 0.007, segment: 'INDEX' },
  { symbol: 'INDIAVIX', exchange: 'NSE', name: 'India VIX', token: '99926017', basePrice: 13.8, volatility: 0.02, segment: 'INDEX' },
  { symbol: 'RELIANCE', exchange: 'NSE', name: 'Reliance Industries', token: '2885', basePrice: 2920, volatility: 0.012 },
  { symbol: 'TCS', exchange: 'NSE', name: 'Tata Consultancy Services', token: '11536', basePrice: 3985, volatility: 0.01 },
  { symbol: 'INFY', exchange: 'NSE', name: 'Infosys', token: '1594', basePrice: 1845, volatility: 0.011 },
  { symbol: 'HDFCBANK', exchange: 'NSE', name: 'HDFC Bank', token: '1333', basePrice: 1725, volatility: 0.009 },
  { symbol: 'ICICIBANK', exchange: 'NSE', name: 'ICICI Bank', token: '4963', basePrice: 1288, volatility: 0.01 },
  { symbol: 'SBIN', exchange: 'NSE', name: 'State Bank of India', token: '3045', basePrice: 820, volatility: 0.013 },
  { symbol: 'BHARTIARTL', exchange: 'NSE', name: 'Bharti Airtel', token: '10604', basePrice: 1620, volatility: 0.012 },
  { symbol: 'ITC', exchange: 'NSE', name: 'ITC', token: '1660', basePrice: 475, volatility: 0.009 },
  { symbol: 'LT', exchange: 'NSE', name: 'Larsen & Toubro', token: '11483', basePrice: 3620, volatility: 0.011 },
  { symbol: 'AXISBANK', exchange: 'NSE', name: 'Axis Bank', token: '5900', basePrice: 1145, volatility: 0.012 },
  { symbol: 'KOTAKBANK', exchange: 'NSE', name: 'Kotak Mahindra Bank', token: '1922', basePrice: 1780, volatility: 0.01 },
  { symbol: 'HINDUNILVR', exchange: 'NSE', name: 'Hindustan Unilever', token: '1394', basePrice: 2485, volatility: 0.008 },
  { symbol: 'BAJFINANCE', exchange: 'NSE', name: 'Bajaj Finance', token: '317', basePrice: 7120, volatility: 0.015 },
  { symbol: 'MARUTI', exchange: 'NSE', name: 'Maruti Suzuki', token: '10999', basePrice: 12450, volatility: 0.012 },
  { symbol: 'SUNPHARMA', exchange: 'NSE', name: 'Sun Pharmaceutical', token: '3351', basePrice: 1788, volatility: 0.01 },
  { symbol: 'TATAMOTORS', exchange: 'NSE', name: 'Tata Motors', token: '3456', basePrice: 920, volatility: 0.016 },
  { symbol: 'WIPRO', exchange: 'NSE', name: 'Wipro', token: '3787', basePrice: 268, volatility: 0.012 },
  { symbol: 'ASIANPAINT', exchange: 'NSE', name: 'Asian Paints', token: '236', basePrice: 2480, volatility: 0.01 },
  { symbol: 'TITAN', exchange: 'NSE', name: 'Titan Company', token: '3506', basePrice: 3450, volatility: 0.013 },
  { symbol: 'ULTRACEMCO', exchange: 'NSE', name: 'UltraTech Cement', token: '11532', basePrice: 11280, volatility: 0.011 },
  { symbol: 'GOLD', exchange: 'MCX', name: 'Gold', token: 'GOLD', basePrice: 76520, volatility: 0.008, segment: 'COMMODITY' },
  { symbol: 'SILVER', exchange: 'MCX', name: 'Silver', token: 'SILVER', basePrice: 91240, volatility: 0.012, segment: 'COMMODITY' },
  { symbol: 'CRUDEOIL', exchange: 'MCX', name: 'Crude Oil', token: 'CRUDEOIL', basePrice: 6245, volatility: 0.018, segment: 'COMMODITY' },
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function seededNoise(seed: number, t: number): number {
  const x = Math.sin(seed * 12.9898 + t * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function marketStatus(): { status: MarketStatus; statusLabel: string } {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  if (day === 0 || day === 6) return { status: 'CLOSED', statusLabel: 'Weekend — Market Closed' };
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) return { status: 'PREOPEN', statusLabel: 'Pre-open (9:00–9:15 IST)' };
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) return { status: 'OPEN', statusLabel: 'Market Open' };
  if (mins >= 15 * 60 + 30 && mins < 16 * 60) return { status: 'POST', statusLabel: 'Post-market' };
  return { status: 'CLOSED', statusLabel: 'Market Closed' };
}

function findInstrument(symbol: string, exchange = 'NSE'): DemoInstrument {
  const upper = symbol.toUpperCase();
  const found = INSTRUMENTS.find(
    (i) => i.symbol === upper && (!exchange || i.exchange === exchange.toUpperCase()),
  ) ?? INSTRUMENTS.find((i) => i.symbol === upper);
  if (!found) {
    return {
      symbol: upper,
      exchange: exchange.toUpperCase(),
      name: upper,
      basePrice: 500 + (hash(upper) % 2000),
      volatility: 0.012,
    };
  }
  return found;
}

function buildQuote(inst: DemoInstrument): Quote {
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const minuteSeed = Math.floor(Date.now() / 60_000);
  const drift = (seededNoise(hash(inst.symbol) + daySeed, 1) - 0.48) * inst.volatility * 2;
  const tick = (seededNoise(hash(inst.symbol) + minuteSeed, 2) - 0.5) * inst.volatility * 0.3;
  const close = inst.basePrice;
  const ltp = Number((close * (1 + drift + tick)).toFixed(2));
  const open = Number((close * (1 + (seededNoise(hash(inst.symbol) + daySeed, 3) - 0.5) * inst.volatility)).toFixed(2));
  const high = Number(Math.max(open, ltp, close * (1 + Math.abs(drift))).toFixed(2));
  const low = Number(Math.min(open, ltp, close * (1 - Math.abs(drift) * 0.8)).toFixed(2));
  const change = Number((ltp - close).toFixed(2));
  const changePercent = Number(((change / close) * 100).toFixed(2));
  const sparkline = Array.from({ length: 24 }, (_, i) => {
    const n = seededNoise(hash(inst.symbol) + daySeed, i + 10);
    return Number((close * (1 + (n - 0.5) * inst.volatility * 1.5 + drift * (i / 24))).toFixed(2));
  });
  return {
    symbol: inst.symbol,
    exchange: inst.exchange,
    name: inst.name,
    token: inst.token,
    ltp,
    open,
    high,
    low,
    close,
    change,
    changePercent,
    volume: 100_000 + (hash(inst.symbol + String(daySeed)) % 5_000_000),
    sparkline,
  };
}

function timeframeMs(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
    '1M': 2_592_000_000,
  };
  return map[tf];
}

function buildCandles(inst: DemoInstrument, tf: Timeframe): Candle[] {
  const step = timeframeMs(tf);
  const count = tf === '1d' || tf === '1w' || tf === '1M' ? 120 : 200;
  const now = Date.now();
  const candles: Candle[] = [];
  let price = inst.basePrice * (1 - inst.volatility * 2);
  for (let i = count; i >= 0; i--) {
    const t = Math.floor((now - i * step) / 1000);
    const n = seededNoise(hash(inst.symbol), i + step);
    const move = (n - 0.5) * inst.volatility * price;
    const open = price;
    const close = Math.max(1, open + move);
    const high = Math.max(open, close) * (1 + n * inst.volatility * 0.3);
    const low = Math.min(open, close) * (1 - (1 - n) * inst.volatility * 0.3);
    candles.push({
      time: t,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 10_000 + Math.floor(n * 500_000),
    });
    price = close;
  }
  return candles;
}

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly name = 'demo';
  readonly isDemo = true;

  async search(query: string): Promise<Instrument[]> {
    const q = query.trim().toUpperCase();
    if (!q) return INSTRUMENTS.slice(0, 20);
    return INSTRUMENTS.filter(
      (i) => i.symbol.includes(q) || i.name.toUpperCase().includes(q),
    ).slice(0, 25);
  }

  async quote(symbol: string, exchange = 'NSE'): Promise<Quote> {
    return buildQuote(findInstrument(symbol, exchange));
  }

  async quotes(symbols: { symbol: string; exchange?: string }[]): Promise<Quote[]> {
    return symbols.map((s) => buildQuote(findInstrument(s.symbol, s.exchange)));
  }

  async candles(symbol: string, timeframe: Timeframe, exchange = 'NSE'): Promise<Candle[]> {
    return buildCandles(findInstrument(symbol, exchange), timeframe);
  }

  async overview(): Promise<MarketOverview> {
    const { status, statusLabel } = marketStatus();
    const indices = await this.quotes([
      { symbol: 'NIFTY' },
      { symbol: 'BANKNIFTY' },
      { symbol: 'SENSEX', exchange: 'BSE' },
      { symbol: 'FINNIFTY' },
      { symbol: 'INDIAVIX' },
    ]);
    const avgChange = indices.slice(0, 3).reduce((a, q) => a + q.changePercent, 0) / 3;
    const vix = indices.find((i) => i.symbol === 'INDIAVIX')?.ltp ?? 14;
    return {
      status,
      statusLabel,
      indices,
      sentiment: avgChange > 0.3 ? 'Bullish' : avgChange < -0.3 ? 'Bearish' : 'Neutral',
      volatilityLabel: vix > 18 ? 'Elevated' : vix > 14 ? 'Moderate' : 'Low',
      news: [
        { id: '1', title: 'RBI keeps repo rate unchanged; markets eye banking stocks', source: 'Demo Wire', publishedAt: new Date().toISOString() },
        { id: '2', title: 'Nifty IT outperforms as global tech cues turn positive', source: 'Demo Wire', publishedAt: new Date().toISOString() },
        { id: '3', title: 'FIIs turn net buyers in cash market for third session', source: 'Demo Wire', publishedAt: new Date().toISOString() },
      ],
      events: [
        { id: 'e1', title: 'Weekly expiry — Nifty / Bank Nifty options', date: 'This Thursday' },
        { id: 'e2', title: 'Major IT earnings window', date: 'Next week' },
      ],
      isDemo: true,
    };
  }

  async topMovers() {
    const equities = INSTRUMENTS.filter((i) => i.segment !== 'INDEX');
    const quotes = equities.map(buildQuote).sort((a, b) => b.changePercent - a.changePercent);
    return {
      gainers: quotes.slice(0, 5),
      losers: [...quotes].reverse().slice(0, 5),
      active: [...quotes].sort((a, b) => b.volume - a.volume).slice(0, 5),
    };
  }

  listAll(): Instrument[] {
    return INSTRUMENTS;
  }
}

export const demoMarketData = new DemoMarketDataProvider();
