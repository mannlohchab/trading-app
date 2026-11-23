// Portfolio holdings: what a user really holds, entered as a table. Pure functions: no framework,
// database or I/O. Quantities and prices stay decimal strings until they are valued.

export const HOLDING_LIMITS = {
  maxRows: 100,
  assetMaxChars: 30,
  earliestDate: '1990-01-01',
} as const;

/** One purchase lot. `buyPrice` is per unit; null when the user doesn't know it. */
export type Holding = { asset: string; quantity: string; boughtOn: string; buyPrice: string | null };
export type HoldingInput = { asset: string; quantity: string; boughtOn: string; buyPrice?: string | null };

const DECIMAL = /^\d{1,18}(\.\d{1,12})?$/;
const ASSET = /^[A-Z0-9][A-Z0-9 .&/_-]*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isPositiveDecimal = (value: string) => DECIMAL.test(value) && Number(value) > 0;

/** Valid calendar date as YYYY-MM-DD (rejects 2024-02-30). */
export function isIsoDate(value: string) {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000);

/** "0.500000000000" → "0.5" (Postgres NUMERIC pads to its scale). */
export function trimDecimal(value: string) {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * Checks a whole table. Errors are keyed `holdings.<row>.<field>` so the app can mark the cell.
 * `today` is the server's UTC date; one day of slack covers users ahead of UTC.
 */
export function validateHoldings(rows: HoldingInput[], today: string):
  { ok: true; holdings: Holding[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (rows.length > HOLDING_LIMITS.maxRows) return { ok: false, errors: { holdings: `At most ${HOLDING_LIMITS.maxRows} rows.` } };
  const latest = isoDay(new Date(dayMs(today) + 86_400_000));
  const holdings = rows.map((row, i) => {
    const key = (field: string) => `holdings.${i}.${field}`;
    const asset = row.asset.replace(/\s+/g, ' ').trim().toUpperCase();
    const quantity = row.quantity.trim();
    const boughtOn = row.boughtOn.trim();
    const buyPrice = row.buyPrice?.trim() || null;

    if (!asset) errors[key('asset')] = 'Enter what you hold, e.g. BTC.';
    else if (asset.length > HOLDING_LIMITS.assetMaxChars) errors[key('asset')] = `Use at most ${HOLDING_LIMITS.assetMaxChars} characters.`;
    else if (!ASSET.test(asset)) errors[key('asset')] = 'Use letters, numbers and . & / _ - only.';

    if (!isPositiveDecimal(quantity)) errors[key('quantity')] = 'Enter a quantity above 0 (up to 12 decimals).';

    if (!isIsoDate(boughtOn)) errors[key('boughtOn')] = 'Enter a valid date.';
    else if (boughtOn < HOLDING_LIMITS.earliestDate) errors[key('boughtOn')] = `Use a date from ${HOLDING_LIMITS.earliestDate.slice(0, 4)} onwards.`;
    else if (boughtOn > latest) errors[key('boughtOn')] = 'The date cannot be in the future.';

    if (buyPrice !== null && !isPositiveDecimal(buyPrice)) errors[key('buyPrice')] = 'Enter a price above 0, or leave it empty.';

    return { asset, quantity: trimDecimal(quantity), boughtOn, buyPrice: buyPrice && trimDecimal(buyPrice) };
  });
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, holdings };
}

// ---- Valuation ----------------------------------------------------------------------------------

/** A lot with the market data found for it. Prices are in `currency` (the pair's quote asset). */
export type PricedLot = Holding & {
  /** Exchange pair used for prices; null when the asset isn't listed. */
  symbol: string | null;
  currentPrice: number | null;
  /** Daily close on `boughtOn`, used when the user gave no buy price. */
  closeOnBuyDate: number | null;
};

export type BuyPriceSource = 'ENTERED' | 'CLOSE_ON_BUY_DATE' | 'MIXED' | 'UNKNOWN';

export type PositionValuation = {
  asset: string;
  symbol: string | null;
  lots: number;
  quantity: number;
  firstBoughtOn: string;
  lastBoughtOn: string;
  /** Days since the first lot was bought. */
  daysHeld: number;
  /** Quantity-weighted, over every lot; null if any lot's buy price is unknown. */
  avgBuyPrice: number | null;
  buyPriceSource: BuyPriceSource;
  cost: number | null;
  currentPrice: number | null;
  value: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  /** Share of the priced portfolio's current value, in percent. */
  sharePercent: number | null;
};

export type PortfolioValuation = {
  currency: string;
  asOf: string;
  lots: number;
  positions: PositionValuation[];
  totals: {
    /** Current value of positions that have a live price. */
    value: number;
    /** Cost of positions with both a live price and a known buy price, and their P/L. */
    cost: number;
    pnl: number;
    pnlPercent: number | null;
    pricedPositions: number;
    positionsInProfit: number;
    positionsInLoss: number;
  };
  concentration: { largestAsset: string | null; largestSharePercent: number | null; top3SharePercent: number | null };
  /** Assets with no live price: only their quantity, dates and entered cost are known. */
  unpricedAssets: string[];
};

/** Prices keep 8 significant digits (works for BTC and for sub-cent coins); money and percents 2 decimals. */
const price = (n: number | null) => n === null ? null : Number(n.toPrecision(8));
const money = (n: number | null) => n === null ? null : Math.round(n * 100) / 100;
const pct = (n: number | null) => n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;

/** Merges lots per asset and values them. Positions come largest first (by value, then cost). */
export function valuePortfolio(lots: PricedLot[], now: Date, currency = 'USDT'): PortfolioValuation {
  const today = isoDay(now);
  const byAsset = new Map<string, PricedLot[]>();
  for (const lot of lots) byAsset.set(lot.asset, [...(byAsset.get(lot.asset) ?? []), lot]);

  const positions = [...byAsset].map(([asset, group]): Omit<PositionValuation, 'sharePercent'> => {
    const quantity = group.reduce((sum, l) => sum + Number(l.quantity), 0);
    const buys = group.map(l => l.buyPrice !== null ? Number(l.buyPrice) : l.closeOnBuyDate);
    const known = buys.every((b): b is number => b !== null);
    const cost = known ? group.reduce((sum, l, i) => sum + Number(l.quantity) * buys[i]!, 0) : null;
    const entered = group.filter(l => l.buyPrice !== null).length;
    const buyPriceSource: BuyPriceSource = !known ? 'UNKNOWN' : entered === group.length ? 'ENTERED' : entered === 0 ? 'CLOSE_ON_BUY_DATE' : 'MIXED';
    const currentPrice = group[0]!.currentPrice;
    const value = currentPrice !== null ? quantity * currentPrice : null;
    const pnl = value !== null && cost !== null ? value - cost : null;
    const dates = group.map(l => l.boughtOn).sort();
    return {
      asset, symbol: group[0]!.symbol, lots: group.length, quantity: Number(quantity.toPrecision(12)),
      firstBoughtOn: dates[0]!, lastBoughtOn: dates.at(-1)!, daysHeld: Math.max(0, daysBetween(dates[0]!, today)),
      avgBuyPrice: price(cost !== null && quantity > 0 ? cost / quantity : null), buyPriceSource,
      cost: money(cost), currentPrice: price(currentPrice), value: money(value), pnl: money(pnl),
      pnlPercent: pct(pnl !== null && cost ? (pnl / cost) * 100 : null),
    };
  });

  const priced = positions.filter(p => p.value !== null);
  const totalValue = priced.reduce((sum, p) => sum + p.value!, 0);
  const withPnl = priced.filter(p => p.pnl !== null);
  const totalCost = withPnl.reduce((sum, p) => sum + p.cost!, 0);
  const totalPnl = withPnl.reduce((sum, p) => sum + p.pnl!, 0);
  const share = (value: number | null) => value === null || totalValue <= 0 ? null : pct((value / totalValue) * 100);

  const ranked = positions
    .map(p => ({ ...p, sharePercent: share(p.value) }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || (b.cost ?? -1) - (a.cost ?? -1) || a.asset.localeCompare(b.asset));
  const top = ranked.filter(p => p.sharePercent !== null);

  return {
    currency,
    asOf: now.toISOString(),
    lots: lots.length,
    positions: ranked,
    totals: {
      value: money(totalValue)!, cost: money(totalCost)!, pnl: money(totalPnl)!,
      pnlPercent: pct(totalCost > 0 ? (totalPnl / totalCost) * 100 : null),
      pricedPositions: priced.length,
      positionsInProfit: withPnl.filter(p => p.pnl! > 0).length,
      positionsInLoss: withPnl.filter(p => p.pnl! < 0).length,
    },
    concentration: {
      largestAsset: top[0]?.asset ?? null,
      largestSharePercent: top[0]?.sharePercent ?? null,
      top3SharePercent: top.length ? pct(top.slice(0, 3).reduce((sum, p) => sum + p.sharePercent!, 0)) : null,
    },
    unpricedAssets: ranked.filter(p => p.value === null).map(p => p.asset),
  };
}

/** Exchange pair to price an asset with: "BTC" → "BTCUSDT"; a pair already in the quote currency is kept. */
export function pricingSymbol(asset: string, quote = 'USDT'): string | null {
  const compact = asset.replace(/[\s/_-]/g, '');
  if (!/^[A-Z0-9]{2,20}$/.test(compact)) return null;
  return compact.endsWith(quote) && compact.length > quote.length ? compact : `${compact}${quote}`;
}
