import { generateSync } from 'otplib';
import { config } from '../lib/config';
import { AppError } from '../lib/errors';
import { demoMarketData } from './demoMarketData';
import { yahooMarketData } from './yahooMarketData';
import { availableQuotes, marketOverview, marketMovers } from './marketSummary';
import type {
  Candle,
  Instrument,
  MarketDataProvider,
  MarketOverview,
  Quote,
  Timeframe,
} from './types';

const BASE = 'https://apiconnect.angelone.in';

type Session = {
  jwtToken: string;
  feedToken: string;
  expiresAt: number;
};

const INTERVAL_MAP: Record<Timeframe, string> = {
  '1m': 'ONE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '1h': 'ONE_HOUR',
  '4h': 'ONE_HOUR',
  '1d': 'ONE_DAY',
  '1w': 'ONE_DAY',
  '1M': 'ONE_DAY',
};

export class AngelOneMarketDataProvider implements MarketDataProvider {
  readonly name = 'angelone';
  readonly isDemo = false;
  private session: Session | null = null;
  private candleCache = new Map<string, { expiresAt: number; result: Promise<Candle[]> }>();
  private candleQueue: Promise<void> = Promise.resolve();
  private nextCandleRequestAt = 0;
  private instrumentCache: Map<string, Instrument & { token: string }> = new Map();

  constructor(private readonly fallback: MarketDataProvider = yahooMarketData) {}

  private async ensureSession(): Promise<Session> {
    if (this.session && this.session.expiresAt > Date.now()) return this.session;

    const totp = generateSync({ secret: config.angel.totpSecret });
    const res = await fetch(`${BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      signal: AbortSignal.timeout(8000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': config.angel.apiKey,
      },
      body: JSON.stringify({
        clientcode: config.angel.clientCode,
        password: config.angel.password,
        totp,
      }),
    });

    const data = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: { jwtToken: string; feedToken: string };
    };

    if (!data.status || !data.data?.jwtToken) {
      throw new AppError(502, `Angel One login failed: ${data.message ?? 'unknown error'}`);
    }

    this.session = {
      jwtToken: data.data.jwtToken,
      feedToken: data.data.feedToken,
      expiresAt: Date.now() + 20 * 60 * 60 * 1000,
    };
    return this.session;
  }

  private async api<T>(path: string, body?: unknown): Promise<T> {
    const session = await this.ensureSession();
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(8000),
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${session.jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': config.angel.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as { status: boolean; message?: string; data: T };
    if (!json.status) throw new AppError(502, json.message ?? 'Angel One API error');
    return json.data;
  }

  private cacheKey(symbol: string, exchange: string) {
    return `${exchange}:${symbol.toUpperCase()}`;
  }

  async resolveToken(symbol: string, exchange = 'NSE'): Promise<Instrument & { token: string }> {
    const key = this.cacheKey(symbol, exchange);
    const cached = this.instrumentCache.get(key);
    if (cached) return cached;

    // Prefer demo instrument tokens for known NSE names when Angel search is unavailable
    const demoHit = (await demoMarketData.search(symbol)).find(
      (i) => i.symbol === symbol.toUpperCase() && i.exchange === exchange,
    );
    if (demoHit?.token) {
      const inst = { ...demoHit, token: demoHit.token };
      this.instrumentCache.set(key, inst);
      return inst;
    }

    throw new AppError(404, `Instrument ${symbol} not found on ${exchange}`);
  }

  async search(query: string): Promise<Instrument[]> {
    // Angel One instrument master is large; use demo catalog filtered + live quotes when available
    return demoMarketData.search(query);
  }

  async quote(symbol: string, exchange = 'NSE'): Promise<Quote> {
    try {
      const inst = await this.resolveToken(symbol, exchange);
      const data = await this.api<{
        ltp: string | number;
        open: string | number;
        high: string | number;
        low: string | number;
        close: string | number;
      }>('/rest/secure/angelbroking/order/v1/getLtpData', {
        exchange,
        tradingsymbol: `${symbol.toUpperCase()}-EQ`,
        symboltoken: inst.token,
      });

      const ltp = Number(data.ltp);
      if (!Number.isFinite(ltp) || ltp <= 0) throw new AppError(502, 'Invalid Angel market price');
      const close = Number(data.close) || ltp;
      const change = Number((ltp - close).toFixed(2));
      return {
        source: 'angelone',
        symbol: symbol.toUpperCase(),
        exchange,
        name: inst.name,
        token: inst.token,
        ltp,
        open: Number(data.open) || ltp,
        high: Number(data.high) || ltp,
        low: Number(data.low) || ltp,
        close,
        change,
        changePercent: close ? Number(((change / close) * 100).toFixed(2)) : 0,
        volume: 0,
      };
    } catch {
      return this.fallback.quote(symbol, exchange);
    }
  }

  async quotes(symbols: { symbol: string; exchange?: string }[]): Promise<Quote[]> {
    return availableQuotes(this, symbols);
  }

  async candles(symbol: string, timeframe: Timeframe, exchange = 'NSE'): Promise<Candle[]> {
    const key = `${this.cacheKey(symbol, exchange)}:${timeframe}`;
    const now = Date.now();
    const cached = this.candleCache.get(key);
    if (cached && cached.expiresAt > now) return cached.result;
    for (const [entryKey, entry] of this.candleCache) {
      if (entry.expiresAt <= now) this.candleCache.delete(entryKey);
    }

    // Coalesce duplicate requests and pace history calls when multiple cards mount.
    const primary = this.candleQueue.then(async () => {
      const delay = Math.max(0, this.nextCandleRequestAt - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextCandleRequestAt = Date.now() + 1000;
      const inst = await this.resolveToken(symbol, exchange);
      const to = new Date();
      const intraday = !['1d', '1w', '1M'].includes(timeframe);
      const from = new Date(to.getTime() - (intraday ? 7 : 90) * 86_400_000);
      // SmartAPI expects exchange-local dates, regardless of the server timezone.
      const fmt = (date: Date) => new Date(date.getTime() + 19_800_000).toISOString().slice(0, 16).replace('T', ' ');
      const data = await this.api<unknown[][]>('/rest/secure/angelbroking/historical/v1/getCandleData', {
        exchange,
        symboltoken: inst.token,
        interval: INTERVAL_MAP[timeframe],
        fromdate: fmt(from),
        todate: fmt(to),
      });
      const candles: Candle[] = (data ?? []).map((row) => ({
        source: 'angelone',
        time: Math.floor(new Date(String(row[0])).getTime() / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5] ?? 0),
      }));
      if (!candles.length || candles.some((c) => ![c.time, c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0))) {
        throw new AppError(502, 'Invalid Angel market history');
      }
      return candles;
    });
    // Pace Angel requests, but let other instruments proceed while Yahoo responds.
    this.candleQueue = primary.then(() => undefined, () => undefined);
    const result = primary.catch(() => {
      return this.fallback.candles(symbol, timeframe, exchange);
    });
    this.candleCache.set(key, { result, expiresAt: now + 60_000 });
    try {
      return await result;
    } catch (error) {
      if (this.candleCache.get(key)?.result === result) this.candleCache.delete(key);
      // Both real feeds failed. Never substitute generated historical prices.
      throw error;
    }
  }

  async overview(): Promise<MarketOverview> {
    return marketOverview(this);
  }

  async topMovers() {
    return marketMovers(this);
  }
}
