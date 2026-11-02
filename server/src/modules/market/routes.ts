import { Router } from 'express';
import { z } from 'zod';
import { getMarketDataProvider } from '../../providers/marketData';
import { optionalAuth } from '../../middleware/auth';
import { param } from '../../lib/params';
import { AppError } from '../../lib/errors';

import { resolveInstrument } from '../../providers/instruments';

async function historyMetadata(symbol: string, exchange?: string) {
  const i = resolveInstrument(symbol, exchange);
  if (i?.exchange === 'BINANCE') return getMarketDataProvider().crypto.instrument(i.symbol);
  return i ?? {};
}

export const marketRouter = Router();

marketRouter.get('/status', optionalAuth, async (_req, res, next) => {
  try {
    const provider = getMarketDataProvider();
    const overview = await provider.overview();
    res.json({
      provider: provider.name,
      isDemo: provider.isDemo,
      status: overview.status,
      statusLabel: overview.statusLabel,
    });
  } catch (err) {
    next(err);
  }
});

marketRouter.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '');
    const results = await getMarketDataProvider().search(q);
    res.json({ results, isDemo: getMarketDataProvider().isDemo });
  } catch (err) {
    next(err);
  }
});

marketRouter.get('/quote/:symbol', async (req, res, next) => {
  try {
    const exchange = req.query.exchange ? String(req.query.exchange) : undefined;
    const quote = await getMarketDataProvider().quote(param(req, 'symbol'), exchange);
    res.json({ quote, isDemo: getMarketDataProvider().isDemo });
  } catch (err) {
    next(err);
  }
});

marketRouter.post('/quotes', async (req, res, next) => {
  try {
    const schema = z.object({
      symbols: z.array(z.object({ symbol: z.string(), exchange: z.string().optional() })).min(1).max(50),
    });
    const body = schema.parse(req.body);
    const quotes = await getMarketDataProvider().quotes(body.symbols);
    res.json({ quotes, isDemo: getMarketDataProvider().isDemo });
  } catch (err) {
    next(err);
  }
});

marketRouter.get('/candles/:symbol', async (req, res, next) => {
  try {
    const timeframe = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']).parse(req.query.timeframe ?? '1d');
    const exchange = req.query.exchange ? String(req.query.exchange) : undefined;
    const provider = getMarketDataProvider();
    if (req.query.liveOnly === 'true' && provider.isDemo) {
      throw new AppError(503, 'Live market history is not configured', 'LIVE_HISTORY_UNAVAILABLE');
    }
    const candles = await provider.candles(param(req, 'symbol'), timeframe, exchange, req.query.fresh === 'true');
    res.json({ candles, isDemo: provider.isDemo, source: candles[0]?.source ?? provider.name, ...(await historyMetadata(param(req, 'symbol'), exchange)) });
  } catch (err) {
    next(err);
  }
});

marketRouter.get('/overview', async (_req, res, next) => {
  try {
    const overview = await getMarketDataProvider().overview();
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

marketRouter.get('/movers', async (_req, res, next) => {
  try {
    const movers = await getMarketDataProvider().topMovers();
    res.json({ ...movers, isDemo: getMarketDataProvider().isDemo });
  } catch (err) {
    next(err);
  }
});

marketRouter.get('/explore', async (_req, res, next) => {
  try {
    res.json(await getMarketDataProvider().explore());
  } catch (err) {
    next(err);
  }
});
