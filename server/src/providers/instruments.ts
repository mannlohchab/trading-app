import { AppError } from '../lib/errors';
import type { Instrument } from './types';

export const globalInstruments: Instrument[] = [
  ...[['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['SOL', 'Solana'], ['BNB', 'BNB'], ['XRP', 'XRP'], ['DOGE', 'Dogecoin']].map(([base, name]) => ({
    symbol: `${base}USDT`, exchange: 'BINANCE', name: `${name} / Tether`, assetClass: 'crypto' as const,
    baseCurrency: base, currency: 'USDT', pricePrecision: ['XRP','DOGE'].includes(base) ? 5 : 2,
  })),
  ...['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD'].map(symbol => ({
    symbol, exchange: 'FOREX', name: symbol, assetClass: 'forex' as const,
    baseCurrency: symbol.slice(0,3), currency: symbol.slice(4), pricePrecision: symbol.endsWith('JPY') ? 3 : 5,
  })),
];
const compact = (s: string) => s.toUpperCase().replace(/[\s/_-]/g, '');
export function resolveInstrument(symbol: string, exchange?: string): Instrument | undefined {
  const ex = exchange?.toUpperCase() === 'CRYPTO' ? 'BINANCE' : exchange?.toUpperCase();
  const found = globalInstruments.find(i => (!ex || i.exchange === ex) && compact(i.symbol) === compact(symbol));
  if (!found && (ex === 'FOREX' || ex === 'BINANCE')) throw new AppError(400, 'Unsupported market pair', 'INVALID_INSTRUMENT');
  return found;
}
export function requireInstrument(symbol: string, exchange: string): Instrument {
  const instrument = resolveInstrument(symbol, exchange);
  if (!instrument) throw new AppError(400, 'Unsupported market pair', 'INVALID_INSTRUMENT');
  return instrument;
}
export function requireInrInstrument(symbol: string, exchange: string) {
  const instrument = resolveInstrument(symbol, exchange);
  if (instrument && instrument.currency !== 'INR') {
    throw new AppError(400, 'Forex and crypto are market-data only. Paper accounts currently support INR instruments.', 'UNSUPPORTED_ACCOUNT_CURRENCY');
  }
}
