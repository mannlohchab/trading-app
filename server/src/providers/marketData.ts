import { config } from '../lib/config';
import { BinanceMarketDataProvider } from './binanceMarketData';
import { TwelveDataProvider } from './twelveData';
import { GlobalMarketDataProvider } from './globalMarketData';
let provider: GlobalMarketDataProvider | null = null;
export function getMarketDataProvider(): GlobalMarketDataProvider {
  return provider ??= new GlobalMarketDataProvider(new BinanceMarketDataProvider(), new TwelveDataProvider(config.twelveData));
}
