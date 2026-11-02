import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as liveMarket from '../src/lib/liveMarket.ts';

test('already connected screens leave awaiting status when crypto or forex quotes arrive',()=>{
  const code=ts.transpileModule(readFileSync(new URL('../src/hooks/use-live-market.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const exchange of ['BINANCE','FOREX']){
    const states=[];let onQuote;const effects=[];const exports={};
    const modules={react:{useState:initial=>[initial,v=>states.push(v)],useEffect:fn=>effects.push(fn),useMemo:fn=>fn()},
      '@tanstack/react-query':{useQueryClient:()=>({invalidateQueries:()=>Promise.resolve()})},
      '@/lib/socket':{subscribeQuotes:(_keys,callback)=>{onQuote=callback;return()=>{};},getSocket:()=>({connected:true,on:()=>{},off:()=>{}})},
      '@/lib/liveMarket':liveMarket,'@/lib/demoMode':{DEMO_MODE:false}};
    runInNewContext(code,{exports,require:n=>modules[n],setInterval:()=>1,clearInterval:()=>{}});
    exports.useLiveMarket([`${exchange}:PAIR`]);const clean=effects[0]();
    onQuote({exchange,symbol:'PAIR',source:exchange==='BINANCE'?'binance':'twelvedata',stale:false});
    assert.match(states.at(-1),exchange==='BINANCE'?/stream connected/:/quote received/);clean();
  }
});
