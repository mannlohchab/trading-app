import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as calendar from '../src/lib/financialCalendar.ts';

test('month grid aligns weekdays and includes the leap day without adjacent-month dates', () => {
  assert.equal(typeof calendar.calendarGrid, 'function');
  const cells = calendar.calendarGrid('2024-02-15', 'month');
  assert.deepEqual(cells.slice(0, 7), [null, null, null, null, '2024-02-01', '2024-02-02', '2024-02-03']);
  assert.equal(cells.length, 35);
  assert.deepEqual(cells.slice(-7), ['2024-02-25', '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', null, null]);
  assert.equal(calendar.calendarGrid('2026-08-15', 'month').length, 42);
});

test('week grid spans the year boundary and preserves dates across daylight saving time', () => {
  assert.equal(typeof calendar.calendarGrid, 'function');
  assert.deepEqual(calendar.calendarGrid('2026-01-01', 'week'), [
    '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03',
  ]);
  assert.deepEqual(calendar.calendarGrid('2026-03-08', 'week'), [
    '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
  ]);
});

test('month navigation clamps month-end dates and crosses years in both directions', () => {
  assert.equal(typeof calendar.moveCalendarDate, 'function');
  assert.equal(calendar.moveCalendarDate('2024-01-31', 1, 'month'), '2024-02-29');
  assert.equal(calendar.moveCalendarDate('2025-01-31', 1, 'month'), '2025-02-28');
  assert.equal(calendar.moveCalendarDate('2026-01-31', -1, 'month'), '2025-12-31');
  assert.equal(calendar.moveCalendarDate('2026-12-15', 1, 'month'), '2027-01-15');
  assert.equal(calendar.moveCalendarDate('2026-01-01', -1, 'week'), '2025-12-25');
});
