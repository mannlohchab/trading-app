import { useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, subscribeQuotes, subscribeCandles } from '@/lib/socket';
import { updateMarketCaches, mergeLiveCandle, CandleBuffer } from '@/lib/liveMarket';
import { DEMO_MODE } from '@/lib/demoMode';
import type { ChartCandle } from '@/components/charts/chartHtml';

export function useLiveMarket(keys: string[]) {
  const client = useQueryClient();
  const identity = [...new Set(keys)].sort().join('|');
  const [limited, setLimited] = useState(0);
  const [status, setStatus] = useState(DEMO_MODE ? 'Demo preview' : 'Connecting');
  useEffect(() => {
    if (DEMO_MODE || !identity) return;
    const pending = new Map<string, any>();
    const off = subscribeQuotes(identity.split('|'), q => {
      pending.set(`${q.exchange}:${q.symbol}`, q);
      if (q.exchange === 'BINANCE' || !identity.includes('BINANCE:')) setStatus(q.stale ? 'Last observation · update delayed' : q.source === 'binance' ? 'Binance stream connected' : q.source === 'twelvedata' ? 'Twelve Data · quote received' : 'Quote received');
    }, setLimited);
    const timer = setInterval(() => { for (const q of pending.values()) updateMarketCaches(client,q); pending.clear(); }, 250);
    const socket = getSocket();
    const disconnected = () => setStatus('Reconnecting · prices may be stale');
    const connected = () => {
      setStatus('Connected · awaiting prices');
      void client.invalidateQueries({queryKey:['quote']});
      void client.invalidateQueries({queryKey:['watchlist-items']});
    };
    const providerStatus = (s: {exchange:string;status:string}) => {
      if (s.exchange === 'BINANCE' && identity.includes('BINANCE:')) setStatus(s.status === 'live' ? 'Binance stream connected' : `Binance · ${s.status}`);
    };
    socket.on('connect',connected);socket.on('disconnect',disconnected);socket.on('market-status',providerStatus);
    if (socket.connected) setStatus('Connected · awaiting prices');
    return () => {off();clearInterval(timer);socket.off('connect',connected);socket.off('disconnect',disconnected);socket.off('market-status',providerStatus);};
  }, [client,identity]);
  return `${status}${limited ? ` · ${limited} pairs use periodic snapshots (live limit: 50)` : ''}`;
}
export function useLiveCandles(symbol: string, exchange: string, timeframe: string) {
  const client = useQueryClient();
  const buffer = useMemo(() => new CandleBuffer<ChartCandle>(), [symbol,exchange,timeframe]);
  useEffect(() => {
    if (DEMO_MODE || exchange !== 'BINANCE') return;
    let lastEvent = 0;
    const key = ['candles',symbol,exchange,timeframe];
    const recover = () => void client.invalidateQueries({queryKey:key});
    const off = subscribeCandles([`${exchange}:${symbol}:${timeframe}`], event => {
      if (event.eventTime <= lastEvent) return; lastEvent = event.eventTime;
      buffer.observe(event.candle);
      client.setQueryData<{candles:ChartCandle[]}>(key, old => old ? {...old,candles:mergeLiveCandle(old.candles,event.candle)} : old);
    });
    const socket = getSocket();let wasLive = false;
    const status = (s:{exchange:string;status:string}) => {
      if (s.exchange !== 'BINANCE') return;
      if (s.status === 'live' && !wasLive) recover();
      wasLive = s.status === 'live';
    };
    socket.on('connect',recover);socket.on('market-status',status);
    return () => {off();socket.off('connect',recover);socket.off('market-status',status);};
  },[client,symbol,exchange,timeframe,buffer]);
  return async <T extends {candles: ChartCandle[]}>(request: () => Promise<T>): Promise<T> => {
    const version = buffer.version;
    const response = await request();
    return {...response, candles: buffer.reconcile(response.candles,version)};
  };
}
