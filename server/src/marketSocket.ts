import type { Server } from 'socket.io';
import { BinanceStream, type StreamStatus } from './providers/binanceStream';
import type { GlobalMarketDataProvider } from './providers/globalMarketData';
import { resolveInstrument } from './providers/instruments';
import { number, validCandles } from './providers/providerCache';

export function normalizeSubscription(input:unknown,candle=false):string|null {
  if(typeof input!=='string' || input.length>80)return null;
  const parts=input.split(':');
  const exchange=parts.length===1?undefined:parts[0].toUpperCase(),symbol=parts.length===1?parts[0].toUpperCase():parts[1].toUpperCase();
  if(candle && (parts.length!==3 || exchange!=='BINANCE' || !/^(1m|5m|15m|30m|1h|4h|1d|1w|1M)$/.test(parts[2])))return null;
  if(!candle && parts.length>2)return null;
  try {
    const i=resolveInstrument(symbol,exchange);
    if(i)return `${i.exchange}:${i.symbol}${candle?':'+parts[2]:''}`;
  }catch { /* Unsupported pairs do not allocate rooms or upstream streams. */ }
  return null;
}

export function attachMarketSocket(io:Server,provider:GlobalMarketDataProvider) {
  const interests=new Map<string,{quotes:Set<string>;candles:Set<string>}>();
  const candleTimes=new Map<string,{time:number;event:number}>();
  let streamStatus:StreamStatus='idle'; let revision=0;let polling=false;
  const stream=new BinanceStream({
    onStatus:status=>{
      if(status===streamStatus)return;streamStatus=status;
      if(status!=='live')provider.crypto.markDisconnected();
      io.emit('market-status',{exchange:'BINANCE',status});
    },
    onMessage:b=>{
      if(b.e==='24hrTicker'){
        const quote=provider.crypto.ingestTicker(b);
        if(quote)io.to(`quote:BINANCE:${quote.symbol}`).emit('quote',quote);
        return Boolean(quote && !quote.stale);
      }else if(b.e==='kline'){
        const k=b.k,key=normalizeSubscription(`BINANCE:${b.s}:${k?.i}`,true);
        if(!key || k.s!==b.s)return false;
        const candle=validCandles([{time:number(k.t)/1000,open:number(k.o),high:number(k.h),low:number(k.l),close:number(k.c),volume:number(k.v,true),source:'binance'}])[0];
        const event=number(b.E),previous=candleTimes.get(key);
        if(previous && (candle.time<previous.time || event<=previous.event))return false;
        candleTimes.set(key,{time:candle.time,event});
        io.to(`candle:${key}`).emit('candle',{symbol:b.s,exchange:'BINANCE',timeframe:k.i,candle,eventTime:event});
        return true;
      }
      return false;
    },
  });
  const reconcile=async()=>{
    const version=++revision;
    const streams=new Set<string>();const symbols=new Set<string>();
    for(const interest of interests.values()){
      for(const key of interest.quotes){const [ex,s]=key.split(':');if(ex==='BINANCE'){streams.add(`${s.toLowerCase()}@ticker`);symbols.add(s);}}
      for(const key of interest.candles){const [,s,tf]=key.split(':');streams.add(`${s.toLowerCase()}@kline_${tf}`);symbols.add(s);}
    }
    // Metadata validates market status and tick precision before accepting upstream prices.
    const results=await Promise.allSettled([...symbols].map(s=>provider.crypto.instrument(s)));
    if(version!==revision)return;
    const valid=new Set(results.flatMap(r=>r.status==='fulfilled'?[r.value.symbol.toLowerCase()]:[]));
    stream.setStreams([...streams].filter(s=>valid.has(s.split('@')[0])));
    if(symbols.size && !valid.size)io.emit('market-status',{exchange:'BINANCE',status:'unavailable'});
  };
  const lastPoll=new Map<string,number>();
  const poll=async()=>{
    if(polling)return;polling=true;
    try {
      const keys=new Set([...interests.values()].flatMap(i=>[...i.quotes]));
      for(const key of lastPoll.keys())if(!keys.has(key))lastPoll.delete(key);
      await Promise.allSettled([...keys].filter(k=>!k.startsWith('BINANCE:')).map(async key=>{
        const [ex,symbol]=key.split(':');const interval=ex==='FOREX'?provider.forex.quoteTtlMs:30000;
        if(ex==='FOREX' && !provider.forex.configured)return;
        if(Date.now()-(lastPoll.get(key)??0)<interval)return;
        lastPoll.set(key,Date.now());
        try{io.to(`quote:${key}`).emit('quote',await provider.quote(symbol,ex));}
        catch{io.to(`quote:${key}`).emit('market-status',{exchange:ex,status:'unavailable'});}
      }));
    }finally{polling=false;}
  };
  io.on('connection',socket=>{
    const interest={quotes:new Set<string>(),candles:new Set<string>()};interests.set(socket.id,interest);
    socket.emit('market-status',{exchange:'BINANCE',status:streamStatus});
    const change=(values:unknown,candle:boolean,remove:boolean)=>{
      if(!Array.isArray(values) || values.length>50)return;
      const target=candle?interest.candles:interest.quotes;
      for(const value of values){const key=normalizeSubscription(value,candle);if(!key)continue;
        const room=`${candle?'candle':'quote'}:${key}`;
        if(remove){target.delete(key);socket.leave(room);}
        else if(target.size<50){target.add(key);socket.join(room);}
      }
      void reconcile();if(!remove)void poll();
    };
    socket.on('subscribe',v=>change(v,false,false));socket.on('unsubscribe',v=>change(v,false,true));
    socket.on('subscribe-candles',v=>change(v,true,false));socket.on('unsubscribe-candles',v=>change(v,true,true));
    socket.on('disconnect',()=>{interests.delete(socket.id);void reconcile();});
  });
  const timer=setInterval(()=>void poll(),5000);
  return ()=>{revision++;clearInterval(timer);stream.stop();interests.clear();};
}
