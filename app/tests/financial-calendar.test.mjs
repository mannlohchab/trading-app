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

test('time zone picker offsets, labels and search', async () => {
  const { formatUtcOffset, timezoneOffsetMinutes, timezoneOption, timezoneOptions } = await import('../src/lib/timezones.ts');
  const winter = new Date('2026-01-15T12:00:00Z'), summer = new Date('2026-07-15T12:00:00Z');
  assert.equal(timezoneOffsetMinutes('Asia/Kolkata', winter), 330);
  assert.equal(timezoneOffsetMinutes('America/New_York', winter), -300);
  assert.equal(timezoneOffsetMinutes('America/New_York', summer), -240);
  assert.equal(formatUtcOffset(0), 'UTC');
  assert.equal(formatUtcOffset(330), 'UTC+5:30');
  assert.equal(formatUtcOffset(-300), 'UTC−5');
  assert.deepEqual({ ...timezoneOption('America/Sao_Paulo', winter) }, { zone: 'America/Sao_Paulo', city: 'Sao Paulo', region: 'America', offset: 'UTC−3', offsetMinutes: -180 });

  const browse = timezoneOptions({ current: 'Asia/Kolkata', device: 'Europe/Lisbon', at: winter });
  assert.deepEqual(browse.slice(0, 2).map(o => o.zone), ['Asia/Kolkata', 'Europe/Lisbon']);
  assert.equal(browse.filter(o => o.zone === 'Asia/Kolkata').length, 1);
  const rest = browse.slice(2).map(o => o.offsetMinutes);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b));

  assert.ok(timezoneOptions({ search: 'new york', zones: ['America/New_York'] }).some(o => o.zone === 'America/New_York'));
  assert.ok(timezoneOptions({ search: 'utc+5:30', at: winter }).every(o => o.offset === 'UTC+5:30'));
  assert.ok(timezoneOptions({ search: 'utc-5', at: winter }).some(o => o.zone === 'America/New_York'));
  assert.deepEqual(timezoneOptions({ search: 'nowhere' }), []);
  assert.ok(!timezoneOptions({ current: 'Not/AZone' }).some(o => o.zone === 'Not/AZone'));
});

test('demo profile saves the calendar time zone', async () => {
  const demo = createDemoApi();
  const saved = await demo.request('/api/v1/me/profile', { method: 'PATCH', body: { timezone: 'America/New_York' } });
  assert.equal(saved.timezone, 'America/New_York');
});
