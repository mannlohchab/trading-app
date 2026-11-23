// Paper trading must never reach a real exchange's trading API. This scans the source that could:
// the paper-trading module itself and the market module it reads prices from.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});
const root = new URL('../../src/modules/', import.meta.url).pathname;
const paper = files(join(root, 'paper-trading'));
const market = files(join(root, 'market'));

test('no exchange trading endpoints, signed requests or API keys anywhere in paper trading or market data', () => {
  const forbidden = [
    /\/api\/v3\/order/i, /\/api\/v3\/account/i, /\/sapi\//i, /\/fapi\//i, /\/dapi\//i, /order\/test/i, /\/myTrades/i,
    /X-MBX-APIKEY/i, /signature=/i, /createHmac/, /api\.binance\.com/i, /api\d?\.binance\.com/i, /testnet/i,
  ];
  const hits = [...paper, ...market].flatMap(f => {
    const text = readFileSync(f, 'utf8');
    return forbidden.filter(r => r.test(text)).map(r => `${f.replace(root, '')}: ${r}`);
  });
  expect(hits).toEqual([]);
});

test('the paper-trading module makes no network calls of its own', () => {
  const hits = paper.filter(f => /\bfetch\s*\(|new WebSocket|Bun\.connect|node:net|node:http/.test(readFileSync(f, 'utf8')));
  expect(hits).toEqual([]);
});

test('market data only uses Binance\'s public market-data hosts', () => {
  const hosts = new Set(market.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/(?:https|wss):\/\/([a-z0-9.-]+)/gi)].map(m => m[1]!.toLowerCase())));
  expect([...hosts].sort()).toEqual(['data-api.binance.vision', 'data-stream.binance.vision']);
});
