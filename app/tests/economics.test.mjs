import assert from 'node:assert/strict';
import { test } from 'node:test';
import { economicValue, calendarDate, economicTime } from '../src/lib/economics.ts';
import { createDemoApi } from '../src/lib/demoData.ts';

test('economic values never mistake zero for missing data', () => {
  assert.equal(economicValue(0), '0'); assert.equal(economicValue('-0.2%'), '-0.2%');
  assert.equal(economicValue(null), '—'); assert.equal(economicValue(''), '—');
});
test('calendar navigation crosses months using UTC days and unknown times stay unknown', () => {
  assert.equal(calendarDate(1, new Date('2026-10-31T23:30:00Z')), '2026-11-01');
  assert.equal(calendarDate(-1, new Date('2026-03-01T00:00:00Z')), '2026-02-28');
  assert.equal(economicTime(null, '2026-11-02'), '2026-11-02 · Time not confirmed');
});
test('economics is available in explicit demo mode with clear sample labels', async () => {
  const demo = createDemoApi();
  for (const path of ['calendar?start=2026-11-02&end=2026-11-08&source=releases', 'indicators?indicator=growth', 'news']) {
    const data = await demo.request(`/api/economics/${path}`);
    assert.equal(data.isDemo, true); assert.match(data.notice, /fictional|sample/i); assert.ok(data.items.length);
  }
});
