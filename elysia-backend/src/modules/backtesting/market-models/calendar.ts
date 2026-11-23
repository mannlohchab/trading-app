import { z } from 'zod';
import type { Timeframe } from '../../market/domain/market-options';
import { timestampSchema } from './contracts';

/** An explicit, versioned schedule: omitted sessions inside coverage are closed, not missing data. */
export const sessionCalendarSchema = z.strictObject({
  timezone: z.string().min(1).max(80).refine(zone => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } }, 'Invalid IANA timezone.'),
  source: z.string().min(1).max(500),
  version: z.string().min(1).max(100),
  coverageStart: timestampSchema,
  coverageEnd: timestampSchema,
  sessions: z.array(z.strictObject({ openTime: timestampSchema, closeTime: timestampSchema, label: z.string().max(100).optional() })).max(30_000),
}).superRefine((v, ctx) => {
  if (v.coverageEnd <= v.coverageStart) ctx.addIssue({ code: 'custom', path: ['coverageEnd'], message: 'Coverage end must follow start.' });
  let previous = v.coverageStart;
  for (const [i, s] of v.sessions.entries()) {
    if (s.openTime < previous || s.closeTime <= s.openTime || s.closeTime > v.coverageEnd) ctx.addIssue({ code: 'custom', path: ['sessions', i], message: 'Sessions must be ordered, non-overlapping, and inside calendar coverage.' });
    previous = s.closeTime;
  }
});
export type SessionCalendar = z.infer<typeof sessionCalendarSchema>;
export type SessionCandle = { openTime: number; closeTime: number };
const STEPS: Partial<Record<Timeframe, number>> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000 };

function sessionAt(calendar: SessionCalendar, time: number) {
  let low = 0, high = calendar.sessions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendar.sessions[middle]!.openTime <= time) low = middle + 1; else high = middle;
  }
  const session = calendar.sessions[low - 1];
  return session && time < session.closeTime ? session : undefined;
}

/** Validates sparse intraday uploads without expanding years of missing minute bars. */
export function matchesIntradaySessionCandle(calendar: SessionCalendar, timeframe: Timeframe, candle: SessionCandle): boolean | undefined {
  const step = STEPS[timeframe];
  if (!step) return undefined;
  const session = sessionAt(calendar, candle.openTime);
  return !!session && (candle.openTime - session.openTime) % step === 0 && candle.closeTime === Math.min(candle.openTime + step, session.closeTime) - 1;
}

export function assertCalendarCoverage(calendar: SessionCalendar, start: number, end: number) {
  if (start < calendar.coverageStart || end > calendar.coverageEnd || start >= end) throw new Error('Requested range is outside the supplied exchange calendar coverage.');
}

/** Session-anchored bars, including a short final intraday bar. End times are inclusive. */
export function expectedSessionCandles(calendar: SessionCalendar, timeframe: Timeframe, start: number, end: number): SessionCandle[] {
  assertCalendarCoverage(calendar, start, end);
  const bars: SessionCandle[] = [];
  const step = STEPS[timeframe];
  if (step) {
    for (const session of calendar.sessions) {
      if (session.closeTime <= start || session.openTime >= end) continue;
      for (let t = session.openTime; t < session.closeTime; t += step) {
        const closeTime = Math.min(t + step, session.closeTime) - 1;
        if (t >= start && closeTime < end) bars.push({ openTime: t, closeTime });
        if (bars.length > 500_000) throw new Error('Calendar range exceeds 500,000 candles.');
      }
    }
  } else {
    const groups = new Map<string, SessionCandle & { periodStart: number; periodEnd: number }>();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: calendar.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const localDate = (time: number) => {
      const parts = date.formatToParts(time);
      const n = (name: string) => Number(parts.find(p => p.type === name)!.value);
      return Date.UTC(n('year'), n('month') - 1, n('day'));
    };
    const coverageStartDay = localDate(calendar.coverageStart), coverageEndDay = localDate(calendar.coverageEnd);
    for (const session of calendar.sessions) {
      const parts = date.formatToParts(session.openTime);
      const n = (name: string) => Number(parts.find(p => p.type === name)!.value);
      const year = n('year'), month = n('month'), day = n('day');
      const localDay = Date.UTC(year, month - 1, day);
      const monday = localDay - ((new Date(localDay).getUTCDay() + 6) % 7) * 86_400_000;
      const key = timeframe === '1M' ? `${year}-${month}` : timeframe === '1w' ? String(monday) : String(localDay);
      const previous = groups.get(key);
      const periodStart = timeframe === '1M' ? Date.UTC(year, month - 1, 1) : timeframe === '1w' ? monday : localDay;
      const periodEnd = timeframe === '1M' ? Date.UTC(year, month, 1) : timeframe === '1w' ? monday + 7 * 86_400_000 : localDay + 86_400_000;
      groups.set(key, { openTime: previous?.openTime ?? session.openTime, closeTime: session.closeTime - 1, periodStart, periodEnd });
    }
    for (const bar of groups.values()) {
      // An incomplete calendar cannot prove that a weekly/monthly bar has closed: a later
      // session (including special weekend trading) may still belong to that same bucket.
      if (timeframe !== '1d' && (coverageStartDay > bar.periodStart || coverageEndDay < bar.periodEnd)) continue;
      if (bar.openTime >= start && bar.closeTime < end) bars.push({ openTime: bar.openTime, closeTime: bar.closeTime });
    }
  }
  return bars;
}

export function calendarWarmupStart(calendar: SessionCalendar, timeframe: Timeframe, start: number, count: number): number {
  if (!Number.isInteger(count) || count < 0) throw new Error('Warm-up count must be a non-negative integer.');
  if (count === 0) return start;
  const step = STEPS[timeframe];
  if (step) {
    if (start < calendar.coverageStart || start > calendar.coverageEnd) throw new Error('Warm-up start is outside calendar coverage.');
    let remaining = count;
    for (let i = calendar.sessions.length - 1; i >= 0; i--) {
      const session = calendar.sessions[i]!;
      if (session.openTime >= start) continue;
      const closedCount = session.closeTime <= start
        ? Math.ceil((session.closeTime - session.openTime) / step)
        : Math.floor((start - session.openTime) / step);
      if (closedCount >= remaining) return session.openTime + (closedCount - remaining) * step;
      remaining -= closedCount;
    }
    throw new Error(`Calendar has only ${count - remaining} warm-up bars; ${count} are required.`);
  }
  const bars = expectedSessionCandles(calendar, timeframe, calendar.coverageStart, start);
  if (bars.length < count) throw new Error(`Calendar has only ${bars.length} warm-up bars; ${count} are required.`);
  return bars[bars.length - count]!.openTime;
}

export function isTradingTime(calendar: SessionCalendar, time: number): boolean {
  if (time < calendar.coverageStart || time >= calendar.coverageEnd) throw new Error('Timestamp is outside calendar coverage.');
  return !!sessionAt(calendar, time);
}
