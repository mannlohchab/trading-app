// FX, currency and commodity tags for news stories. Crypto coin codes stay in `assets.ts`;
// this module adds tradable macro instruments so Home chips can show what a headline may move.

export type ImpactKind = 'crypto' | 'currency' | 'fx_pair' | 'commodity';

export type NewsImpact = {
  code: string;
  kind: ImpactKind;
  label: string;
};

type Pattern = { code: string; kind: Exclude<ImpactKind, 'crypto'>; label: string; names: RegExp };

// Conservative patterns: prefer missing a tag over tagging every “dollar” story.
const MACRO: Pattern[] = [
  { code: 'USD', kind: 'currency', label: 'US Dollar', names: /\b(us\s*dollar|greenback|dxy|dollar\s+index)\b/i },
  { code: 'EUR', kind: 'currency', label: 'Euro', names: /\b(euro(?!\s*zone\s+alone)|ecb)\b/i },
  { code: 'GBP', kind: 'currency', label: 'Pound Sterling', names: /\b(pound\s+sterling|british\s+pound|sterling|bank\s+of\s+england|boee?\b|gbp)\b/i },
  { code: 'JPY', kind: 'currency', label: 'Japanese Yen', names: /\b(japanese\s+yen|\byen\b|bank\s+of\s+japan|boj)\b/i },
  { code: 'CHF', kind: 'currency', label: 'Swiss Franc', names: /\b(swiss\s+franc|snb)\b/i },
  { code: 'AUD', kind: 'currency', label: 'Australian Dollar', names: /\b(australian\s+dollar|aussie\s+dollar|rba)\b/i },
  { code: 'CAD', kind: 'currency', label: 'Canadian Dollar', names: /\b(canadian\s+dollar|loonie|bank\s+of\s+canada|boc)\b/i },
  { code: 'NZD', kind: 'currency', label: 'New Zealand Dollar', names: /\b(new\s+zealand\s+dollar|kiwi\s+dollar|rbnz)\b/i },
  { code: 'CNY', kind: 'currency', label: 'Chinese Yuan', names: /\b(chinese\s+yuan|renminbi|\byuan\b|pboc)\b/i },
  { code: 'INR', kind: 'currency', label: 'Indian Rupee', names: /\b(indian\s+rupee|\brupee\b|rbi)\b/i },
  { code: 'EURUSD', kind: 'fx_pair', label: 'EUR/USD', names: /\beur\s*\/?\s*usd\b|\beurusd\b/i },
  { code: 'GBPUSD', kind: 'fx_pair', label: 'GBP/USD', names: /\bgbp\s*\/?\s*usd\b|\bgbpusd\b|\bcable\b/i },
  { code: 'USDJPY', kind: 'fx_pair', label: 'USD/JPY', names: /\busd\s*\/?\s*jpy\b|\busdjpy\b/i },
  { code: 'XAU', kind: 'commodity', label: 'Gold', names: /\b(gold\s+prices?|spot\s+gold|xau(?:usd)?|bullion)\b/i },
  { code: 'XAG', kind: 'commodity', label: 'Silver', names: /\b(silver\s+prices?|spot\s+silver|xag(?:usd)?)\b/i },
  { code: 'WTI', kind: 'commodity', label: 'Crude Oil (WTI)', names: /\b(crude\s+oil|wti|brent\s+crude|oil\s+prices?)\b/i },
  { code: 'COPPER', kind: 'commodity', label: 'Copper', names: /\b(copper\s+prices?|hg\s+copper)\b/i },
];

const CRYPTO_CODES = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH',
  'SHIB', 'TON', 'SUI', 'NEAR', 'APT', 'UNI', 'XLM', 'PEPE', 'ARB', 'OP', 'FIL', 'ETC', 'HBAR',
  'AAVE', 'TAO', 'HYPE', 'USDT', 'USDC',
]);

const CRYPTO_LABELS: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin',
  ADA: 'Cardano', USDT: 'Tether', USDC: 'USD Coin',
};

const MACRO_BY_CODE = new Map(MACRO.map(m => [m.code, m]));

/** Macro (FX / commodity / currency) codes mentioned in free text. */
export function detectMacroImpacts(text: string): NewsImpact[] {
  const found = new Map<string, NewsImpact>();
  for (const item of MACRO) {
    if (item.names.test(text)) found.set(item.code, { code: item.code, kind: item.kind, label: item.label });
  }
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Classify a stored asset code into an impact chip (crypto or macro). */
export function classifyAssetCode(code: string): NewsImpact | null {
  const upper = code.trim().toUpperCase();
  if (!upper) return null;
  const macro = MACRO_BY_CODE.get(upper);
  if (macro) return { code: macro.code, kind: macro.kind, label: macro.label };
  if (CRYPTO_CODES.has(upper)) {
    return { code: upper, kind: 'crypto', label: CRYPTO_LABELS[upper] ?? upper };
  }
  // Unknown short codes from CryptoPanic still surface as crypto-style chips.
  if (/^[A-Z0-9]{2,10}$/.test(upper)) return { code: upper, kind: 'crypto', label: upper };
  return null;
}

/** Impacts for API/UI: macro detections plus classification of every stored asset code. */
export function impactsForArticle(text: string, assets: string[]): NewsImpact[] {
  const byCode = new Map<string, NewsImpact>();
  for (const impact of detectMacroImpacts(text)) byCode.set(impact.code, impact);
  for (const code of assets) {
    const impact = classifyAssetCode(code);
    if (impact) byCode.set(impact.code, impact);
  }
  return [...byCode.values()].sort((a, b) => {
    const order: Record<ImpactKind, number> = { fx_pair: 0, currency: 1, commodity: 2, crypto: 3 };
    return order[a.kind] - order[b.kind] || a.code.localeCompare(b.code);
  });
}
