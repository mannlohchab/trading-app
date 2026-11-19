import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const lib = (() => {
  const source = readFileSync(new URL('../src/lib/portfolioHoldings.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const modules = { './api': { api: () => { throw new Error('No network in unit tests'); } } };
  const exports = {};
  runInNewContext(outputText, { exports, require: name => modules[name], Date });
  return exports;
})();
const { parseDateInput, formatDate, parseNumberInput, rowsToHoldings, cellErrorsFromServer, parsePastedTable, rowsFromTable, emptyRow } = lib;
// Objects from the vm context have another realm's prototype; compare plain copies.
const json = value => JSON.parse(JSON.stringify(value));
const plain = rows => json(rows).map(({ key, ...rest }) => rest);

test('dates: day first, ISO accepted, impossible dates rejected', () => {
  assert.equal(parseDateInput('05/03/2025'), '2025-03-05');
  assert.equal(parseDateInput('5-3-25'), '2025-03-05');
  assert.equal(parseDateInput('05.03.2025'), '2025-03-05');
  assert.equal(parseDateInput('2025-03-05'), '2025-03-05');
  assert.equal(parseDateInput('31/02/2025'), null);
  assert.equal(parseDateInput('March 5'), null);
  assert.equal(formatDate('2025-03-05'), '05/03/2025');
});

test('numbers: currency symbols and thousands separators are dropped', () => {
  assert.equal(parseNumberInput('₹1,250.50'), '1250.50');
  assert.equal(parseNumberInput(' 0.005 '), '0.005');
  assert.equal(parseNumberInput('$ 60,000'), '60000');
  assert.equal(parseNumberInput('0'), null);
  assert.equal(parseNumberInput('-3'), null);
  assert.equal(parseNumberInput('abc'), null);
});

test('rows → holdings: blank rows skipped, bad cells reported by row key', () => {
  const rows = [
    { ...emptyRow(), asset: 'btc', quantity: '0.5', boughtOn: '10/01/2025', buyPrice: '60,000' },
    emptyRow(),
    { ...emptyRow(), key: 'bad', asset: '', quantity: 'x', boughtOn: '2025/13/01', buyPrice: 'free' },
    { ...emptyRow(), asset: 'ETH', quantity: '2', boughtOn: '01/03/2026', buyPrice: '' },
  ];
  const { holdings, rowKeys, errors } = rowsToHoldings(rows);
  assert.equal(holdings.length, 3);
  assert.deepEqual(json(holdings[0]), { asset: 'btc', quantity: '0.5', boughtOn: '2025-01-10', buyPrice: '60000' });
  assert.deepEqual(json(holdings[2]), { asset: 'ETH', quantity: '2', boughtOn: '2026-03-01', buyPrice: null });
  assert.deepEqual(Object.keys(errors).sort(), ['bad.asset', 'bad.boughtOn', 'bad.buyPrice', 'bad.quantity']);
  assert.deepEqual(json(rowKeys), [rows[0].key, 'bad', rows[3].key]);
});

test('server errors land on the right cell', () => {
  assert.deepEqual(json(cellErrorsFromServer({ 'holdings.1.boughtOn': 'Future date', holdings: 'x', 'holdings.9.asset': 'nope' }, ['a', 'b'])), { 'b.boughtOn': 'Future date' });
  assert.deepEqual(json(cellErrorsFromServer(undefined, ['a'])), {});
});

test('paste from Excel with a header in any column order', () => {
  const text = 'Stock\tBuy Date\tQty\tAvg Price\r\nReliance\t10/06/2024\t4\t2,900.50\r\nbtc\t2025-01-10\t0.5\t\r\n';
  assert.deepEqual(plain(parsePastedTable(text)), [
    { asset: 'RELIANCE', quantity: '4', boughtOn: '10/06/2024', buyPrice: '2900.50' },
    { asset: 'BTC', quantity: '0.5', boughtOn: '10/01/2025', buyPrice: '' },
  ]);
});

test('paste CSV without a header uses the default column order and keeps quoted numbers whole', () => {
  assert.deepEqual(plain(parsePastedTable('ETH,2,01/03/2026,"1,950"\nSOL,10,15/08/2025\n')), [
    { asset: 'ETH', quantity: '2', boughtOn: '01/03/2026', buyPrice: '1950' },
    { asset: 'SOL', quantity: '10', boughtOn: '15/08/2025', buyPrice: '' },
  ]);
  assert.deepEqual(json(parsePastedTable('  \n')), []);
});

test('saved table → editable rows', () => {
  const rows = rowsFromTable({ holdings: [{ asset: 'BTC', quantity: '0.5', boughtOn: '2025-01-10', buyPrice: null }], updatedAt: null });
  assert.deepEqual(plain(rows), [{ asset: 'BTC', quantity: '0.5', boughtOn: '10/01/2025', buyPrice: '' }]);
});
