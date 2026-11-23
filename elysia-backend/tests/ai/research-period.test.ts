import { describe, expect, test } from 'bun:test';
import { resolveResearchPeriod, type ResearchPeriodInput } from '../../src/modules/ai/domain/research-period';

describe('research calendar dates', () => {
  test('India dates use explicit +05:30 local midnights and include the end date by default', () => {
    const range = resolveResearchPeriod({ startDate: '2026-01-01', endDate: '2026-01-31', timezone: 'Asia/Kolkata' });
    expect(range).toMatchObject({ startIso: '2025-12-31T18:30:00.000Z', endIso: '2026-01-31T18:30:00.000Z', timezone: 'Asia/Kolkata', startDate: '2026-01-01', endDate: '2026-01-31', endDateInclusive: true });
    expect(range.range).toEqual({ start: Date.parse(range.startIso), end: Date.parse(range.endIso) });
    expect(range.semantics).toContain('end is exclusive');
  });

  test('UTC same-day inclusion is a day while an exclusive end is its beginning', () => {
    const sameDay = resolveResearchPeriod({ startDate: '2026-01-31', endDate: '2026-01-31', timezone: 'UTC' });
    expect(sameDay.startIso).toBe('2026-01-31T00:00:00.000Z');
    expect(sameDay.endIso).toBe('2026-02-01T00:00:00.000Z');
    const exclusive = resolveResearchPeriod({ startDate: '2026-01-01', endDate: '2026-02-01', timezone: 'UTC', endDateInclusive: false });
    expect(exclusive.endIso).toBe('2026-02-01T00:00:00.000Z');
    expect(exclusive.endDateInclusive).toBe(false);
  });

  test('New York spring DST day is exactly 23 hours', () => {
    const period = resolveResearchPeriod({ startDate: '2026-03-08', endDate: '2026-03-08', timezone: 'America/New_York' });
    expect(period.startIso).toBe('2026-03-08T05:00:00.000Z');
    expect(period.endIso).toBe('2026-03-09T04:00:00.000Z');
    expect(period.range.end - period.range.start).toBe(23 * 60 * 60 * 1000);
  });

  test('New York autumn DST day is exactly 25 hours', () => {
    const period = resolveResearchPeriod({ startDate: '2026-11-01', endDate: '2026-11-01', timezone: 'America/New_York' });
    expect(period.startIso).toBe('2026-11-01T04:00:00.000Z');
    expect(period.endIso).toBe('2026-11-02T05:00:00.000Z');
    expect(period.range.end - period.range.start).toBe(25 * 60 * 60 * 1000);
  });

  test('calendar addition handles leap days rather than assuming fixed month lengths', () => {
    expect(resolveResearchPeriod({ startDate: '2024-02-29', endDate: '2024-02-29', timezone: 'UTC' }).endIso).toBe('2024-03-01T00:00:00.000Z');
  });

  test('impossible, out-of-format and pre-1970 dates fail', () => {
    for (const startDate of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '1969-12-31', '0099-01-01']) {
      expect(() => resolveResearchPeriod({ startDate, endDate: '2026-12-31', timezone: 'UTC' })).toThrow();
    }
    expect(() => resolveResearchPeriod({ startDate: '2026-01-01', endDate: '2026-02-30', timezone: 'UTC' })).toThrow('endDate');
  });

  test('reversed and exclusive empty ranges fail before execution', () => {
    expect(() => resolveResearchPeriod({ startDate: '2026-02-01', endDate: '2026-01-31', timezone: 'UTC' })).toThrow('end date');
    expect(() => resolveResearchPeriod({ startDate: '2026-02-01', endDate: '2026-02-01', timezone: 'UTC', endDateInclusive: false })).toThrow('end date');
  });

  test('unknown, absent or fixed-offset timezone inputs never fall back to host timezone', () => {
    for (const timezone of ['', 'Not/A_Zone', '+05:30', ' Asia/Kolkata ', undefined]) {
      expect(() => resolveResearchPeriod({ startDate: '2026-01-01', endDate: '2026-01-02', timezone } as ResearchPeriodInput)).toThrow('timezone');
    }
    expect(() => resolveResearchPeriod({ startDate: '2026-01-01', endDate: '2026-01-02', timezone: 'UTC', endDateInclusive: 'false' } as unknown as ResearchPeriodInput)).toThrow('boolean');
  });

  test('nonexistent and ambiguous midnights require explicit instants', () => {
    for (const [date, timezone] of [['2018-11-04', 'America/Sao_Paulo'], ['2015-11-01', 'America/Havana'], ['2011-12-30', 'Pacific/Apia']]) {
      expect(() => resolveResearchPeriod({ startDate: date!, endDate: date!, timezone: timezone! })).toThrow('explicit ISO timestamp');
    }
    // An inclusive end cannot conceal that its own local date never existed.
    expect(() => resolveResearchPeriod({ startDate: '2011-12-29', endDate: '2011-12-30', timezone: 'Pacific/Apia' })).toThrow('explicit ISO timestamp');
  });

  test('calendar year 1970 is insufficient when its offset resolves to a negative epoch', () => {
    expect(() => resolveResearchPeriod({ startDate: '1970-01-01', endDate: '1970-01-02', timezone: 'Asia/Kolkata' })).toThrow('nonnegative');
    expect(resolveResearchPeriod({ startDate: '1970-01-01', endDate: '1970-01-01', timezone: 'UTC' }).range.start).toBe(0);
  });
});
