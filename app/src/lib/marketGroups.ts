import type { QuoteLike } from '@/components/markets/InstrumentRow';

export function groupQuotes(quotes: QuoteLike[]) {
  const crypto: QuoteLike[] = [];
  const forex: QuoteLike[] = [];

  for (const q of quotes) {
    if (q.exchange === 'BINANCE') crypto.push(q);
    else if (q.exchange === 'FOREX') forex.push(q);
  }

  return { crypto, forex };
}
