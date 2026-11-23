// Which coins an article is about, so the app can show news on an instrument's page (BTCUSDT → BTC).
// Matching is deliberately conservative: a missed tag is better than tagging every story "OP" or "ONE".

type AssetPattern = { code: string; names: RegExp; /** Ticker written in capitals, e.g. "SOL", or "$SOL". */ ticker?: boolean };

// `names` are case-insensitive unless the word is also an ordinary English word, in which case the
// pattern is case-sensitive (e.g. "Optimism" the network vs "optimism").
const ASSETS: AssetPattern[] = [
  { code: 'BTC', names: /\bbitcoin(?!\s+(cash|sv)\b)/i, ticker: true },
  { code: 'ETH', names: /\b(ethereum|ether)\b/i, ticker: true },
  { code: 'SOL', names: /\bsolana\b/i, ticker: true },
  { code: 'XRP', names: /\b(xrp|ripple)\b/i, ticker: true },
  { code: 'BNB', names: /\b(bnb|bnb chain|binance coin)\b/i, ticker: true },
  { code: 'DOGE', names: /\bdogecoin\b/i, ticker: true },
  { code: 'ADA', names: /\bcardano\b/i, ticker: true },
  { code: 'TRX', names: /\btron\b/i, ticker: true },
  { code: 'AVAX', names: /\bavalanche\b(?=.*\b(avax|crypto|token|network|blockchain|subnet)\b)|\bavax\b/i, ticker: true },
  { code: 'LINK', names: /\bchainlink\b/i, ticker: true },
  { code: 'DOT', names: /\bpolkadot\b/i, ticker: true },
  { code: 'LTC', names: /\blitecoin\b/i, ticker: true },
  { code: 'BCH', names: /\bbitcoin cash\b/i, ticker: true },
  { code: 'SHIB', names: /\bshiba inu\b/i, ticker: true },
  { code: 'TON', names: /\btoncoin\b|\bThe Open Network\b/i },
  { code: 'SUI', names: /\bSui\b/ },
  { code: 'NEAR', names: /\bNEAR Protocol\b/i },
  { code: 'APT', names: /\baptos\b/i, ticker: true },
  { code: 'UNI', names: /\buniswap\b/i },
  { code: 'XLM', names: /\bstellar lumens?\b|\bStellar\b(?=.*\b(xlm|network|blockchain|crypto)\b)/i, ticker: true },
  { code: 'PEPE', names: /\bpepe\b/i, ticker: true },
  { code: 'ARB', names: /\barbitrum\b/i, ticker: true },
  { code: 'OP', names: /\bOptimism\b(?=.*\b(network|layer|mainnet|superchain|token)\b)|\bOP Mainnet\b/ },
  { code: 'FIL', names: /\bfilecoin\b/i, ticker: true },
  { code: 'ETC', names: /\bethereum classic\b/i },
  { code: 'HBAR', names: /\bhedera\b/i, ticker: true },
  { code: 'AAVE', names: /\baave\b/i },
  { code: 'TAO', names: /\bbittensor\b/i, ticker: true },
  { code: 'HYPE', names: /\bhyperliquid\b/i },
  { code: 'USDT', names: /\btether\b|\bUSDT\b/ },
  { code: 'USDC', names: /\bUSDC\b|\bUSD Coin\b/ },
];

const TICKERS = new Map(ASSETS.filter(a => a.ticker).map(a => [a.code, a.code]));
// Upper-case tickers as whole words ("BTC", "$SOL"), but not inside longer upper-case runs or pairs like "BTCUSDT".
const TICKER_TOKEN = /(?<![A-Za-z0-9])\$?([A-Z]{3,5})(?![A-Za-z0-9])/g;

/** Coin codes mentioned in `text`, plus any whose ticker appears among `categories`. Sorted. */
export function detectAssets(text: string, categories: string[] = []): string[] {
  const found = new Set<string>();
  for (const asset of ASSETS) if (asset.names.test(text)) found.add(asset.code);
  for (const match of text.matchAll(TICKER_TOKEN)) {
    const code = TICKERS.get(match[1]!);
    if (code) found.add(code);
  }
  for (const category of categories) {
    const code = TICKERS.get(category.toUpperCase()) ?? ASSETS.find(a => a.names.test(category))?.code;
    if (code) found.add(code);
  }
  return [...found].sort();
}
