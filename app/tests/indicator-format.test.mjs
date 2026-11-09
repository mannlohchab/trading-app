import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAggregateEconomy, formatIndicatorValue, indicatorChange, indicatorSummary, sortIndicators } from '../src/lib/indicatorFormat.ts';

test('indicator values are rounded and unit-aware', () => {
  assert.equal(formatIndicatorValue('2.53719472', '% annual'), '2.5%');
  assert.equal(formatIndicatorValue('-0.84', '%'), '−0.8%');
  assert.equal(formatIndicatorValue('27360935000000', 'current US$'), '$27.36T');
  assert.equal(formatIndicatorValue('1850000000', 'current US$'), '$1.85B');
  assert.equal(formatIndicatorValue(null, '%'), '—');
  assert.equal(formatIndicatorValue('n/a', '%'), 'n/a');
});

test('changes use percentage points for % indicators and relative change otherwise', () => {
  assert.deepEqual(indicatorChange({ latest: '2.5', previous: '2.3', unit: '% annual' })?.label, '▲ 0.2 pts');
  assert.deepEqual(indicatorChange({ latest: '3.1', previous: '4.0', unit: '% of labor force' })?.label, '▼ 0.9 pts');
  assert.equal(indicatorChange({ latest: '110', previous: '100', unit: 'current US$' })?.label, '▲ 10.0%');
  assert.equal(indicatorChange({ latest: '2.5', previous: '2.5', unit: '%' })?.label, 'No change');
  assert.equal(indicatorChange({ latest: '2.5', previous: null, unit: '%' }), null);
  assert.equal(indicatorChange({ latest: '5', previous: '0', unit: 'current US$' }), null);
});

test('sorting ranks by value, puts missing values last, and summary finds median and extremes', () => {
  const items = [
    { country: 'B', latest: '1.0', previous: '3.0', unit: '%' },
    { country: 'A', latest: '5.0', previous: '4.9', unit: '%' },
    { country: 'C', latest: '', previous: null, unit: '%' },
    { country: 'D', latest: '-2.0', previous: '-1.0', unit: '%' },
  ];
  assert.deepEqual(sortIndicators(items, 'Highest').map(i => i.country), ['A', 'B', 'D', 'C']);
  assert.deepEqual(sortIndicators(items, 'Lowest').map(i => i.country), ['D', 'B', 'A', 'C']);
  assert.deepEqual(sortIndicators(items, 'Biggest move').map(i => i.country), ['B', 'D', 'A', 'C']);
  assert.deepEqual(sortIndicators(items, 'A–Z').map(i => i.country), ['A', 'B', 'C', 'D']);
  const summary = indicatorSummary(items);
  assert.equal(summary.count, 3); assert.equal(summary.median, 1); assert.equal(summary.maxAbs, 5);
  assert.equal(summary.highest.item.country, 'A'); assert.equal(summary.lowest.item.country, 'D');
  assert.equal(indicatorSummary([{ country: 'X', latest: '' }]), null);
});

test('regions and income groups are separated from countries', () => {
  for (const id of ['WLD', 'EMU', 'OED', 'XD', 'XT']) assert.equal(isAggregateEconomy(id), true, id);
  for (const id of ['USA', 'IND', 'ZAF', 'CAF', 'ASM']) assert.equal(isAggregateEconomy(id), false, id);
});

test('narrative names the leader, the lowest and the median in plain language', async () => {
  const { indicatorNarrative } = await import('../src/lib/indicatorFormat.ts');
  const summary = indicatorSummary([{ country: 'Guyana', latest: '19.27' }, { country: 'Chad', latest: '3.2' }, { country: 'New Caledonia', latest: '-13.5' }]);
  assert.equal(indicatorNarrative(summary, '% annual', 'countries'),
    'Guyana leads at 19.3%, while New Caledonia is lowest at −13.5%. The median across 3 countries is 3.2%.');
  assert.equal(indicatorNarrative(indicatorSummary([{ country: 'Sample economy', latest: '2.5' }]), '% annual', 'economies'),
    'Sample economy reports 2.5%. The median across 1 economy is 2.5%.');
});
