// Adapters from the AI module's gateways to other modules' public services.
import type { MarketDataService } from '../../market/application/market-data.service';
import { summarizeMarket } from '../../market/domain/analysis';
import type { Ticker } from '../../market/domain/types';
import type { ProfileService } from '../../profiles/application/profile.service';
import { describeCondition, type StrategyService } from '../../strategies';
import type { StrategySaver } from '../application/conversation.service';
import type { PersonaSource } from '../application/ports';
import type { MarketGateway, StrategyDraftChecker, TickerView } from '../application/tools';

const view = (t: Ticker): TickerView => ({
  symbol: t.symbol, lastPrice: t.lastPrice, priceChangePercent: t.priceChangePercent,
  highPrice: t.highPrice, lowPrice: t.lowPrice, quoteVolume: t.quoteVolume, time: t.time,
});

export function marketGateway(market: MarketDataService, exchange = 'BINANCE'): MarketGateway {
  return {
    exchange,
    async searchSymbols(query, quoteAsset) {
      const { items } = await market.searchSymbols({ exchange, query, quoteAsset, limit: 10 });
      return items.map(i => ({ symbol: i.symbol, baseAsset: i.baseAsset, quoteAsset: i.quoteAsset }));
    },
    async tickers(symbols) {
      return (await market.tickersFor(exchange, symbols)).map(view);
    },
    async topMovers(quoteAsset, sort, limit) {
      return (await market.tickerList({ exchange, quoteAsset, sort, limit })).map(view);
    },
    async analyze(symbol, timeframe, candles) {
      const result = await market.candles({ exchange, symbol, timeframe, limit: candles });
      return { summary: summarizeMarket(result.candles), source: result.source };
    },
    async candles(symbol, timeframe, limit) {
      const result = await market.candles({ exchange, symbol, timeframe, limit });
      return { candles: result.candles, source: result.source };
    },
  };
}

export function strategyGateway(strategies: StrategyService): StrategyDraftChecker & StrategySaver {
  return {
    async validate(draft) {
      const result = await strategies.validate(draft);
      if (!result.ok) return result;
      const d = result.draft.definition;
      const summary = [
        `Market: ${d.market.symbol} on ${d.market.exchange}, ${d.market.timeframe} candles, ${d.direction.toLowerCase()} only`,
        `Enter when: ${d.entry.conditions.map(describeCondition).join(' AND ')}`,
        d.exit.conditions.length ? `Exit when: ${d.exit.conditions.map(describeCondition).join(' OR ')}` : null,
        d.exit.stopLossPercent !== undefined ? `Stop loss: ${d.exit.stopLossPercent}%` : null,
        d.exit.takeProfitPercent !== undefined ? `Take profit: ${d.exit.takeProfitPercent}%` : null,
        `Position size: ${d.risk.positionSizePercent}% of balance`,
      ].filter((x): x is string => !!x);
      return { ok: true, draft: result.draft, summary };
    },
    async save(userId, draft, origin) {
      const result = await strategies.create(userId, draft, 'AI_GENERATED', { origin });
      return result.ok ? { ok: true, strategyId: result.strategy.id } : result;
    },
  };
}

export function personaSource(profiles: ProfileService): PersonaSource {
  return {
    async forUser(userId) {
      const p = await profiles.getPreferences(userId);
      return { responseStyle: p.ai.responseStyle, explanationLevel: p.ai.explanationLevel, language: p.ai.language ?? p.general.language, timezone: p.general.timezone };
    },
  };
}
