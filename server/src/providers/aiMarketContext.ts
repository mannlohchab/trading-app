import { globalInstruments, resolveInstrument } from './instruments';
import type { Instrument, MarketDataProvider, Quote } from './types';

const forexNames: Record<string, string[]> = {
  'EUR/USD': ['euro dollar', 'euro to dollar', 'euro vs dollar'],
  'GBP/USD': ['pound dollar', 'pound to dollar', 'sterling dollar', 'cable'],
  'USD/JPY': ['dollar yen', 'dollar to yen'],
  'USD/CHF': ['dollar franc', 'dollar to franc'],
  'AUD/USD': ['aussie dollar', 'australian dollar'],
  'USD/CAD': ['dollar cad', 'dollar to canadian dollar'],
  'NZD/USD': ['kiwi dollar', 'new zealand dollar'],
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findMentionedInstruments(message: string): Instrument[] {
  const normalized = message.replace(/\s*\/\s*/g, '/');
  return globalInstruments.flatMap(instrument => {
    const pair = instrument.assetClass === 'crypto' ? `${instrument.baseCurrency}/${instrument.currency}` : instrument.symbol;
    const aliases = [instrument.symbol, pair, pair.replace('/', ''), pair.replace('/', '-'), pair.replace('/', '_'),
      ...(instrument.assetClass === 'crypto' ? [instrument.baseCurrency!, instrument.name.split(' / ')[0]] : forexNames[instrument.symbol] ?? [])];
    const matches = aliases.flatMap(alias => {
      // A base ticker must not match a different explicitly written pair, e.g. BTC/USD.
      const match = new RegExp(`(?:^|[^a-z0-9/_-])(${escape(alias)})(?![a-z0-9]|[/_-][a-z])`, 'i').exec(normalized);
      return match ? [match.index] : [];
    });
    return matches.length ? [{ instrument, index: Math.min(...matches) }] : [];
  }).sort((a, b) => a.index - b.index).map(match => match.instrument);
}

type Request = { message: string; history?: string[]; symbol?: string; exchange?: string; kind?: string };

function conversationSelection(message: string, prior: Instrument[]): Instrument[] {
  const mentioned = findMentionedInstruments(message);
  const pairs = message.match(/\b[a-z0-9]{2,10}\s*\/\s*[a-z0-9]{2,10}\b|\b[a-z0-9]{2,8}(?:usdt|usd)\b/gi) ?? [];
  const unsupported = pairs.some(pair => !resolveInstrument(pair));
  const refersBack = /\b(it|its|that pair|that coin|that market|those|them|these pairs|same pair)\b|^(?:refresh|update)(?: please)?[.!?]*$/i.test(message);
  // An unsupported explicit pair or a new topic resets reference context.
  if (unsupported || !refersBack) return mentioned;
  if (!mentioned.length) return prior;
  if (/\b(compare|versus|vs|against)\b/i.test(message)) {
    return [...prior, ...mentioned.filter(i => !prior.some(p => p.symbol === i.symbol))];
  }
  return mentioned;
}

function describeQuote(q: Quote): string {
  const time = q.asOf && Number.isFinite(q.asOf) ? new Date(q.asOf * 1000).toISOString() : 'unknown';
  const freshness = q.stale || !q.asOf ? 'stale or freshness unknown; do not describe as live' : 'latest available observation';
  return `${q.symbol} (${q.exchange}, ${q.name}): price ${q.ltp} ${q.currency ?? 'unknown currency'}, change ${q.change} (${q.changePercent}%), open ${q.open}, high ${q.high}, low ${q.low}, previous reference ${q.close}. ` +
    (q.assetClass === 'forex' || q.exchange === 'FOREX' ? 'Centralized forex volume is unavailable. ' : `Base-asset volume ${q.volume}; change and range cover the rolling 24-hour window. `) +
    `Source: ${q.source ?? 'unknown'}; observed at ${time}; ${freshness}.`;
}

export async function buildMarketContext(request: Request, provider: MarketDataProvider, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  let prior: Instrument[] = [];
  for (const previous of request.history ?? []) prior = conversationSelection(previous, prior);
  let instruments = conversationSelection(request.message, prior);
  if (request.symbol) {
    let selected: Instrument | undefined;
    try { selected = resolveInstrument(request.symbol, request.exchange); } catch { /* Report without substituting another asset. */ }
    if (!selected) return 'The requested instrument is unsupported on the selected exchange. No quote supplied. Ask for a supported crypto or forex pair; do not substitute a different instrument.';
    instruments = [selected, ...instruments.filter(i => i.symbol !== selected.symbol)];
  }
  if (!instruments.length) return 'No current market observations supplied for this request. If asked for a price, ask the user to name a supported pair; never use a remembered price as current.';
  const selected = instruments.slice(0, 3);
  const lines = ['Market observations fetched for this turn (a point-in-time snapshot, not a continuous stream):'];
  if (instruments.length > selected.length) lines.push('Lookup limit: only the first three mentioned instruments were fetched; other requested instruments have no current quote.');
  // Fetch quotes first so limited forex credits are not consumed by optional history.
  const quotes = await Promise.allSettled(selected.map(i => provider.quote(i.symbol, i.exchange)));
  signal?.throwIfAborted();
  const needsHistory = request.kind === 'analysis' || /\b(analy[sz]e|analysis|trend|candles?|support|resistance|technicals?)\b/i.test(request.message);
  const sections = await Promise.all(selected.map(async (instrument, index) => {
    const result = quotes[index];
    if (result.status === 'rejected') return `${instrument.symbol}: quote unavailable. Do not invent its current price or change.`;
    let section = describeQuote(result.value);
    if (needsHistory) {
      try {
        const candles = await provider.candles(instrument.symbol, '1d', instrument.exchange);
        const recent = candles.slice(-5);
        section += recent.length ? `\nRecent daily candles (the latest may still be forming): ${recent.map(c => `${new Date(c.time * 1000).toISOString()} close ${c.close}`).join('; ')}. These few closes are insufficient for RSI or MACD.` : '\nDaily history unavailable; do not infer a trend from missing candles.';
      } catch { section += '\nDaily history unavailable; base the answer only on the available quote.'; }
    }
    return section;
  }));
  signal?.throwIfAborted();
  return [...lines, ...sections].join('\n\n');
}
