// The user's real holdings (`/api/v1/portfolio`), edited as a table and analysed by the AI assistant.
// Cells are kept as typed; they are checked and converted only when the table is saved.
import { api } from './api';

export type Holding = { asset: string; quantity: string; boughtOn: string; buyPrice: string | null };
export type HoldingsTable = { holdings: Holding[]; updatedAt: string | null };

export const HOLDING_FIELDS = ['asset', 'quantity', 'boughtOn', 'buyPrice'] as const;
export type HoldingField = (typeof HOLDING_FIELDS)[number];
/** One editable row. `boughtOn` is shown as DD/MM/YYYY. */
export type HoldingRow = { key: string } & Record<HoldingField, string>;
/** Cell errors keyed `<row key>.<field>`. */
export type CellErrors = Record<string, string>;

export const MAX_HOLDING_ROWS = 100;

let nextKey = 0;
export const emptyRow = (): HoldingRow => ({ key: `row-${Date.now()}-${++nextKey}`, asset: '', quantity: '', boughtOn: '', buyPrice: '' });
export const isBlankRow = (row: HoldingRow) => HOLDING_FIELDS.every(field => !row[field].trim());

export function listHoldings(signal?: AbortSignal) {
  return api<HoldingsTable>('/api/v1/portfolio/holdings', { signal });
}

export function saveHoldings(holdings: Holding[]) {
  return api<HoldingsTable>('/api/v1/portfolio/holdings', { method: 'PUT', body: { holdings } });
}

// ---- Cells ----------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * A typed or pasted date as YYYY-MM-DD, or null. Day comes first (DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY),
 * as written in India; YYYY-MM-DD is also accepted. Two-digit years mean 20xx.
 */
export function parseDateInput(text: string): string | null {
  const value = text.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [day, month, year] = [Number(dmy[1]), Number(dmy[2]), dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])];
  else return null;
  return validDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** YYYY-MM-DD → DD/MM/YYYY. */
export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/** A typed or pasted amount as a plain decimal string ("₹1,250.50" → "1250.50"), or null. */
export function parseNumberInput(text: string): string | null {
  const value = text.replace(/[\s,₹$€£]/g, '').replace(/^(INR|USD|USDT|RS\.?)/i, '');
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) return null;
  return value.replace(/^0+(?=\d)/, '');
}

export const rowsFromTable = (table: HoldingsTable): HoldingRow[] =>
  table.holdings.map(h => ({ ...emptyRow(), asset: h.asset, quantity: h.quantity, boughtOn: formatDate(h.boughtOn), buyPrice: h.buyPrice ?? '' }));

/**
 * Converts the table for saving. Blank rows are dropped. Returns cell errors when something can't be
 * read, plus `rowKeys` so server errors (`holdings.<index>.<field>`) can be put on the right cell.
 */
export function rowsToHoldings(rows: HoldingRow[]): { holdings: Holding[]; rowKeys: string[]; errors: CellErrors } {
  const errors: CellErrors = {};
  const holdings: Holding[] = [];
  const rowKeys: string[] = [];
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const cell = (field: HoldingField, message: string) => { errors[`${row.key}.${field}`] = message; };
    const asset = row.asset.trim();
    const quantity = parseNumberInput(row.quantity);
    const boughtOn = parseDateInput(row.boughtOn);
    const buyPrice = row.buyPrice.trim() ? parseNumberInput(row.buyPrice) : null;
    if (!asset) cell('asset', 'What do you hold? e.g. BTC');
    if (!quantity) cell('quantity', 'Enter a quantity above 0');
    if (!boughtOn) cell('boughtOn', 'Use DD/MM/YYYY');
    if (row.buyPrice.trim() && !buyPrice) cell('buyPrice', 'Enter a price above 0, or leave it empty');
    holdings.push({ asset, quantity: quantity ?? row.quantity.trim(), boughtOn: boughtOn ?? row.boughtOn.trim(), buyPrice });
    rowKeys.push(row.key);
  }
  return { holdings, rowKeys, errors };
}

/** Server field errors (`holdings.2.quantity`) → cell errors. */
export function cellErrorsFromServer(fields: unknown, rowKeys: string[]): CellErrors {
  const errors: CellErrors = {};
  if (!fields || typeof fields !== 'object') return errors;
  for (const [path, message] of Object.entries(fields as Record<string, string>)) {
    const match = /^holdings\.(\d+)\.(\w+)$/.exec(path);
    const key = match && rowKeys[Number(match[1])];
    if (key && (HOLDING_FIELDS as readonly string[]).includes(match[2]!)) errors[`${key}.${match[2]}`] = String(message);
  }
  return errors;
}

// ---- Paste from a spreadsheet ---------------------------------------------------------------------

const HEADER_WORDS: Record<HoldingField, RegExp> = {
  asset: /asset|symbol|ticker|stock|coin|scrip|name|instrument|holding/i,
  quantity: /qty|quant|units|shares/i,
  boughtOn: /date|bought|purchase|buy date|acquired/i,
  buyPrice: /price|avg|average|cost|rate|buy/i,
};

function splitLine(line: string, separator: string) {
  if (separator !== ',') return line.split(separator);
  // CSV: respect quotes, so "1,250.50" stays one cell.
  const cells: string[] = [];
  let current = '', quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

/**
 * Rows copied from Excel or Google Sheets (tab-separated) or a CSV. A header row, if any, decides
 * the column order; otherwise columns are Asset, Quantity, Bought on, Buy price.
 */
export function parsePastedTable(text: string): HoldingRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
  if (!lines.length) return [];
  const separator = lines[0]!.includes('\t') ? '\t' : lines[0]!.includes(';') ? ';' : ',';
  let table = lines.map(line => splitLine(line, separator).map(cell => cell.trim()));

  let order: (HoldingField | null)[] = [...HOLDING_FIELDS];
  const first = table[0]!;
  const looksLikeHeader = first.some(cell => /[a-z]/i.test(cell)) && !first.slice(1).some(cell => parseNumberInput(cell) || parseDateInput(cell));
  if (looksLikeHeader) {
    const used = new Set<HoldingField>();
    // Most specific first: "Buy price" must not be read as the purchase date column.
    const pick = (cell: string) => (['quantity', 'boughtOn', 'buyPrice', 'asset'] as const).find(field => {
      if (used.has(field)) return false;
      if (field === 'boughtOn' && /price|cost|rate/i.test(cell)) return false;
      return HEADER_WORDS[field].test(cell);
    }) ?? null;
    order = first.map(cell => { const field = pick(cell); if (field) used.add(field); return field; });
    if (!used.has('asset') || !used.has('quantity')) order = [...HOLDING_FIELDS];
    table = table.slice(1);
  }

  return table.slice(0, MAX_HOLDING_ROWS).map(cells => {
    const row = emptyRow();
    order.forEach((field, i) => {
      if (!field || cells[i] === undefined) return;
      const value = cells[i]!;
      if (field === 'boughtOn') { const iso = parseDateInput(value); row.boughtOn = iso ? formatDate(iso) : value; }
      else if (field === 'quantity' || field === 'buyPrice') row[field] = parseNumberInput(value) ?? value;
      else row.asset = value.toUpperCase();
    });
    return row;
  }).filter(row => !isBlankRow(row));
}
