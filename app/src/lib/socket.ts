import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { DEMO_MODE } from './demoMode';
import { QuoteSubscriptions } from './quoteSubscriptions';
let socket: Socket | null = null;
let quotes: QuoteSubscriptions | null = null;
let candles: QuoteSubscriptions | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io(API_URL, {transports:['websocket'],autoConnect:true,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000});
  return socket;
}
export function subscribeQuotes(keys: string[], onQuote: (quote: any) => void, onLimit?: (count: number) => void) {
  if (DEMO_MODE || !keys.length) return () => {};
  quotes ??= new QuoteSubscriptions(getSocket());
  return quotes.subscribe(keys, onQuote, onLimit);
}
export function subscribeCandles(keys: string[], onCandle: (event: any) => void) {
  if (DEMO_MODE || !keys.length) return () => {};
  candles ??= new QuoteSubscriptions(getSocket(), true);
  return candles.subscribe(keys, onCandle);
}
