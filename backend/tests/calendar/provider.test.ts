import { expect, test } from 'bun:test';
import { CalendarService } from '../../src/modules/calendar/application/calendar.service';

export const release = { title: 'CPI y/y', country: 'USD', date: '2026-11-23T08:30:00-05:00', impact: 'High', forecast: '2.5%', previous: '2.4%' };
function setup(body: unknown = [release]) {
  let now = Date.parse('2026-11-23T12:00:00Z');
  let status = 200;
  let calls = 0;
  const service = new CalendarService({ now: () => now, request: async () => { calls++; return Response.json(body, { status }); } });
  return { service, advance: (ms: number) => { now += ms; }, fail: (code = 503) => { status = code; }, calls: () => calls };
}

test('normalizes published timestamps and values without inventing actuals', async () => {
  const { service } = setup([release, { ...release, title: 'Jobs', actual: 0, forecast: '', previous: '-0.1%' }]);
  const feed = await service.getWeek();
  expect(feed.items[0]).toMatchObject({ event: 'CPI y/y', currency: 'USD', date: '2026-11-23T13:30:00.000Z', importance: 3, actual: null, forecast: '2.5%' });
  expect(feed.items[1]).toMatchObject({ actual: '0', forecast: null, previous: '-0.1%' });
  expect(feed).toMatchObject({ source: 'Forex Factory', isDemo: false, stale: false, fetchedAt: '2026-11-23T12:00:00.000Z' });
});

test('date-only releases and holidays do not become midnight instants', async () => {
  const { service } = setup([{ ...release, date: '2026-11-23', impact: 'Holiday' }, { ...release, title: 'Bank holiday', impact: 'Holiday' }]);
  const { items } = await service.getWeek();
  expect(items.every(e => e.date === null && e.day === '2026-11-23' && e.estimated)).toBe(true);
  expect(items.every(e => e.importance === null)).toBe(true);
});

test('identical events keep stable IDs when provider ordering changes', async () => {
  const second = { ...release, title: 'GDP' };
  const a = await setup([release, second, release]).service.getWeek();
  const b = await setup([second, release]).service.getWeek();
  expect(a.items).toHaveLength(2);
  expect(a.items.find(e => e.event === 'CPI y/y')?.id).toBe(b.items.find(e => e.event === 'CPI y/y')?.id);
});

test('holiday dates follow the affected market rather than the feed offset', async () => {
  const t = setup([{ title: 'Bank Holiday', country: 'JPY', date: '2026-11-22T19:00:00-05:00', impact: 'Holiday', forecast: '', previous: '' }]);
  expect((await t.service.getWeek()).items[0]).toMatchObject({ day: '2026-11-23', date: null, status: 'holiday' });
});

test('coalesces concurrent loads and reuses the cache across clients', async () => {
  const t = setup();
  await Promise.all([t.service.getWeek(), t.service.getWeek(), t.service.getWeek()]);
  await t.service.getWeek();
  expect(t.calls()).toBe(1);
  t.advance(3_600_001);
  await t.service.getWeek();
  expect(t.calls()).toBe(2);
});

test('failed refresh serves labeled stale data, backs off, then expires it', async () => {
  const t = setup();
  await t.service.getWeek();
  t.advance(3_600_001); t.fail();
  expect((await t.service.getWeek()).stale).toBe(true);
  expect((await t.service.getWeek()).fetchedAt).toBe('2026-11-23T12:00:00.000Z');
  expect(t.calls()).toBe(2);
  t.advance(86_400_000);
  await expect(t.service.getWeek()).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
});

test('cold failure also backs off and honors provider Retry-After', async () => {
  let now = 0, calls = 0;
  const service = new CalendarService({ now: () => now, request: async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }); } });
  await expect(service.getWeek()).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
  now += 1_800_000;
  await expect(service.getWeek()).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
  expect(calls).toBe(1);
  now += 1_800_001;
  await expect(service.getWeek()).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
  expect(calls).toBe(2);
});

test('malformed payloads are errors, and a genuinely empty feed stays empty', async () => {
  for (const body of [{ error: 'down' }, [{}], [{ ...release, date: '2026-02-30T08:30:00-05:00' }], [{ ...release, date: 'nonsense' }], [{ ...release, title: '' }]]) {
    await expect(setup(body).service.getWeek()).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
  }
  expect((await setup([]).service.getWeek()).items).toEqual([]);
});
