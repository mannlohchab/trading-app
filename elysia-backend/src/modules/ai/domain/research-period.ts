/** Local calendar dates become exact UTC instants before an AI tool requests market data. */
export type ResearchPeriodInput = {
  startDate: string;
  endDate: string;
  timezone: string;
  /** Include all of endDate, ending at midnight of the next local date. Defaults to true. */
  endDateInclusive?: boolean;
};

// Native Temporal is present in the supported Bun runtime. Keep its tiny used surface explicit:
// this project's ES2022 TypeScript library does not declare the newer global yet.
type CalendarDate = { year: number; month: number; day: number; add(duration: { days: number }): CalendarDate };
type TemporalApi = {
  PlainDate: { from(value: string, options: { overflow: 'reject' }): CalendarDate };
  ZonedDateTime: { from(value: { year: number; month: number; day: number; hour: number; minute: number; second: number; timeZone: string }, options: { disambiguation: 'reject'; overflow: 'reject' }): { epochMilliseconds: number } };
};

function nativeTemporal(): TemporalApi {
  const temporal = (globalThis as typeof globalThis & { Temporal?: TemporalApi }).Temporal;
  if (typeof temporal?.PlainDate?.from !== 'function' || typeof temporal?.ZonedDateTime?.from !== 'function') {
    throw new Error('Exact calendar-date conversion requires native Temporal in the server runtime. Supply explicit ISO timestamps with UTC offsets instead.');
  }
  return temporal;
}

function parseDate(value: string, label: string, temporal: TemporalApi): CalendarDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1970) {
    throw new Error(`${label} must be a YYYY-MM-DD calendar date with a year from 1970 through 9999.`);
  }
  try { return temporal.PlainDate.from(value, { overflow: 'reject' }); }
  catch { throw new Error(`${label} is not a valid calendar date.`); }
}

function midnight(date: CalendarDate, timezone: string, temporal: TemporalApi): number {
  let value: number;
  try {
    value = temporal.ZonedDateTime.from({ year: date.year, month: date.month, day: date.day, hour: 0, minute: 0, second: 0, timeZone: timezone }, { disambiguation: 'reject', overflow: 'reject' }).epochMilliseconds;
  } catch {
    throw new Error(`Local midnight on ${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')} in ${timezone} is ambiguous, nonexistent or unsupported. Supply an explicit ISO timestamp with its UTC offset instead.`);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Research boundaries must resolve to nonnegative Unix milliseconds (1970-01-01T00:00:00Z or later).');
  return value;
}

/**
 * No host-timezone fallback, fixed 24-hour arithmetic or DST guessing. Midnight discontinuities
 * reject so the user can specify the intended instant. Exchange sessions are resolved elsewhere.
 * Native behavior: https://tc39.es/proposal-temporal/docs/zoneddatetime.html#from
 */
export function resolveResearchPeriod(input: ResearchPeriodInput) {
  if (!input || typeof input !== 'object') throw new Error('Provide startDate, endDate and an explicit IANA timezone.');
  const { startDate, endDate, timezone } = input;
  if (typeof timezone !== 'string' || timezone.length > 100 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)) {
    throw new Error('Provide an explicit IANA timezone such as Asia/Kolkata, America/New_York or UTC.');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0); }
  catch { throw new Error(`Unknown or unsupported IANA timezone: ${timezone}.`); }
  if (input.endDateInclusive !== undefined && typeof input.endDateInclusive !== 'boolean') throw new Error('endDateInclusive must be a boolean.');
  const endDateInclusive = input.endDateInclusive ?? true;
  const temporal = nativeTemporal();
  const first = parseDate(startDate, 'startDate', temporal), last = parseDate(endDate, 'endDate', temporal);
  // Strict YYYY-MM-DD form permits a reliable calendar-date comparison before timezone conversion.
  if (endDate < startDate || (!endDateInclusive && endDate === startDate)) throw new Error('The end date must follow the start date, or equal it only when endDateInclusive is true.');
  const start = midnight(first, timezone, temporal);
  // Resolve the requested end date too: including a skipped/ambiguous date must not silently
  // replace it with the next valid date even when that next midnight would be unambiguous.
  const endDateMidnight = midnight(last, timezone, temporal);
  const end = endDateInclusive ? midnight(last.add({ days: 1 }), timezone, temporal) : endDateMidnight;
  if (end <= start) throw new Error('The resolved end instant must be after the start instant.');
  return {
    range: { start, end }, startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString(),
    timezone, startDate, endDate, endDateInclusive,
    semantics: `Start is inclusive at local midnight in ${timezone}; end is exclusive at ${endDateInclusive ? 'midnight after endDate' : 'midnight on endDate'} in the same timezone. Calendar-day boundaries only; exchange sessions and available closed candles are validated separately.`,
  };
}
