import type { QuoteLike } from '@/components/markets/InstrumentRow';

const INDEX_SET = new Set(['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'INDIAVIX']);
const FUTURES_SET = new Set(['GOLD', 'SILVER', 'CRUDEOIL', 'NIFTYFUT', 'BANKNIFTYFUT']);

export function groupQuotes(quotes: QuoteLike[]) {
  const crypto: QuoteLike[] = [];
  const forex: QuoteLike[] = [];
  const indices: QuoteLike[] = [];
  const stocks: QuoteLike[] = [];
  const futures: QuoteLike[] = [];

  for (const q of quotes) {
    const sym = q.symbol.toUpperCase();
    if (q.exchange === 'BINANCE') crypto.push(q);
    else if (q.exchange === 'FOREX') forex.push(q);
    else if (INDEX_SET.has(sym) || q.exchange === 'INDEX') indices.push(q);
    else if (FUTURES_SET.has(sym) || sym.endsWith('FUT')) futures.push(q);
    else stocks.push(q);
  }

  return { crypto, forex, indices, stocks, futures };
}
