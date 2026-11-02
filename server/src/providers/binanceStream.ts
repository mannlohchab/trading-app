import { globalInstruments } from './instruments';
export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'idle';
export type StreamSocket = { onopen: ((...args:any[])=>void)|null; onclose: ((...args:any[])=>void)|null;
  onmessage: ((...args:any[])=>void)|null; onerror: ((...args:any[])=>void)|null; close():void };
type Options = { onMessage:(body:any)=>boolean; onStatus:(status:StreamStatus)=>void; createSocket?:(url:string)=>StreamSocket;
  now?:()=>number; schedule?:(fn:()=>void,ms:number)=>any; cancel?:(id:any)=>void };
const symbols=new Set(globalInstruments.filter(i=>i.exchange==='BINANCE').map(i=>i.symbol.toLowerCase()));
export class BinanceStream {
  private socket:StreamSocket|null=null;
  private streams:string[]=[];
  private timer:any; private health:any; private attempts=0; private lastMessage=0; private openedAt=0;
  private now:()=>number; private schedule:(fn:()=>void,ms:number)=>any; private cancel:(id:any)=>void;
  constructor(private options:Options) {
    this.now=options.now ?? Date.now; this.schedule=options.schedule ?? setTimeout; this.cancel=options.cancel ?? clearTimeout;
  }
  setStreams(streams:string[]) {
    const next=[...new Set(streams)].filter(s=>{
      const [symbol,event]=s.split('@'); return symbols.has(symbol) && /^(ticker|kline_(1m|5m|15m|30m|1h|4h|1d|1w|1M))$/.test(event??'');
    }).sort().slice(0,64);
    if(next.join('/')===this.streams.join('/')) return;
    this.streams=next;this.disconnect();this.cancel(this.timer);
    if(!next.length){this.options.onStatus('idle');return;}
    this.options.onStatus('connecting');this.timer=this.schedule(()=>this.connect(),500);
  }
  private disconnect(){ const s=this.socket;this.socket=null;this.cancel(this.health);s?.close(); }
  private reconnect(){
    this.disconnect();this.cancel(this.timer);
    if(!this.streams.length)return;
    this.options.onStatus('reconnecting');
    this.timer=this.schedule(()=>this.connect(),Math.min(30000,1000*2**Math.min(this.attempts++,5))+Math.random()*500);
  }
  private connect(){
    if(!this.streams.length)return;
    try {
      const s=(this.options.createSocket ?? (url=>new WebSocket(url)))(`wss://stream.binance.com:443/stream?streams=${this.streams.join('/')}`);
      this.socket=s;this.openedAt=this.lastMessage=this.now();
      s.onopen=()=>{if(this.socket===s)this.lastMessage=this.now();};
      s.onclose=()=>{if(this.socket===s)this.reconnect();};
      s.onerror=()=>{if(this.socket===s)this.reconnect();};
      s.onmessage=(event: {data:any})=>{
        if(this.socket!==s)return;
        try {
          const b=JSON.parse(String(event.data));const data=b.data??b;
          if(data.e==='serverShutdown'){this.reconnect();return;}
          if(!['24hrTicker','kline'].includes(data.e))return;
          if (typeof data.E !== 'number' || data.E < this.now() - 30000 || data.E > this.now() + 5000) return;
          if (!this.options.onMessage(data)) return;
          this.lastMessage=this.now();this.attempts=0;this.options.onStatus('live');
        } catch { /* Malformed events must not replace the last valid observation. */ }
      };
      const check=()=>{if(this.socket!==s)return;
        if(this.now()-this.lastMessage>30000 || this.now()-this.openedAt>23*3600_000){this.reconnect();return;}
        this.health=this.schedule(check,10000);
      };
      this.health=this.schedule(check,10000);
    } catch {this.reconnect();}
  }
  stop(){this.streams=[];this.cancel(this.timer);this.disconnect();this.options.onStatus('idle');}
}
