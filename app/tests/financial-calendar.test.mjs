import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarSections, eventDay, filterCalendarEvents } from '../src/lib/financialCalendar.ts';
import { createDemoApi } from '../src/lib/demoData.ts';

const event = { id: 'cpi', event: 'Consumer inflation', country: 'USD', currency: 'USD', day: '2026-11-23', date: '2026-11-23T23:30:00Z', importance: 3, actual: null, forecast: '2.5%', previous: '0', estimated: false };

test('groups events by the displayed timezone, not their UTC date', () => {
  assert.equal(eventDay(event, 'Asia/Kolkata'), '2026-11-24');
  assert.equal(eventDay(event, 'America/New_York'), '2026-11-23');
  const dateOnly = { ...event, id: 'holiday', date: null, day: '2026-11-23', estimated: true };
  assert.equal(eventDay(dateOnly, 'Asia/Kolkata'), '2026-11-23');
  const sections = calendarSections([event, dateOnly], 'Asia/Kolkata');
  assert.deepEqual(sections.map(s => s.key), ['2026-11-23', '2026-11-24']);
  assert.equal(sections[1].data[0].id, 'cpi');
});

test('search, date and impact filters compose without treating unrated events as low impact', () => {
  const events = [event, { ...event, id: 'gdp', event: 'GDP', importance: null }];
  assert.deepEqual(filterCalendarEvents(events, { search: ' usd ', impact: 'high', day: '2026-11-24' }, 'Asia/Kolkata').map(e => e.id), ['cpi']);
  assert.equal(filterCalendarEvents(events, { search: '', impact: 'low', day: 'all' }).length, 0);
  assert.equal(filterCalendarEvents(events, { search: 'GDP', impact: 'all', day: 'all' }).length, 1);
  assert.equal(filterCalendarEvents(events, { search: '', impact: 'all', day: '2026-11-23' }, 'Asia/Kolkata').length, 0);
});

test('agenda sorts timed events and keeps unknown times explicitly undated', () => {
  const early = { ...event, id: 'early', date: '2026-11-23T01:00:00Z' };
  const unknown = { ...event, id: 'unknown', date: null, day: null };
  const sections = calendarSections([event, unknown, early], 'UTC');
  assert.deepEqual(sections[0].data.map(e => e.id), ['early', 'cpi']);
  assert.equal(sections[1].key, 'undated');
});

test('new calendar endpoint is supported only by the explicitly selected demo API', async () => {
  const data = await createDemoApi().request('/api/v1/calendar');
  assert.equal(data.isDemo, true);
  assert.match(data.notice, /fictional|sample/i);
  assert.ok(data.items.length > 0);
  assert.ok(data.items.every(e => e.id && e.event && e.day));
});
