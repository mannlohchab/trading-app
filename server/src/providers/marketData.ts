import { config, hasAngelCredentials } from '../lib/config';
import { AngelOneMarketDataProvider } from './angelOneMarketData';
import { yahooMarketData } from './yahooMarketData';
import { BinanceMarketDataProvider } from './binanceMarketData';
import { TwelveDataProvider } from './twelveData';
import { GlobalMarketDataProvider } from './globalMarketData';
let provider: GlobalMarketDataProvider | null = null;
export function getMarketDataProvider(): GlobalMarketDataProvider {
  return provider ??= new GlobalMarketDataProvider(hasAngelCredentials() ? new AngelOneMarketDataProvider() : yahooMarketData,
    new BinanceMarketDataProvider(), new TwelveDataProvider(config.twelveData));
}
