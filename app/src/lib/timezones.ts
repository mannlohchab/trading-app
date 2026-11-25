/** Time zones offered when searching is not possible or the search box is empty: the main market centres. */
export const POPULAR_TIMEZONES = [
  'UTC', 'America/Los_Angeles', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Zurich', 'Africa/Johannesburg', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
] as const;

export type TimezoneOption = { zone: string; city: string; region: string; offset: string; offsetMinutes: number };

export function isTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

/** Minutes ahead of UTC at `at`. Computed from formatted parts, since `shortOffset` names are not on every engine. */
export function timezoneOffsetMinutes(zone: string, at = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'));
  return Math.round((wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const hours = Math.floor(Math.abs(minutes) / 60), rest = Math.abs(minutes) % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

export function timezoneOption(zone: string, at = new Date()): TimezoneOption {
  const segments = zone.split('/');
  const offsetMinutes = timezoneOffsetMinutes(zone, at);
  return {
    zone, offsetMinutes, offset: formatUtcOffset(offsetMinutes),
    city: (segments.at(-1) ?? zone).replaceAll('_', ' '),
    region: segments.length > 1 ? segments.slice(0, -1).join(' / ').replaceAll('_', ' ') : 'Coordinated Universal Time',
  };
}

/** Every zone the engine knows, or the popular list when it cannot enumerate them. */
export function allTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf;
  try {
    const zones = supported?.('timeZone');
    if (zones?.length) return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch { /* fall through to the popular list */ }
  return [...POPULAR_TIMEZONES];
}

/**
 * The picker's rows. With no search: the current and device zones first, then the popular list by offset.
 * With a search: any known zone whose name, city or offset matches.
 */
export function timezoneOptions({ search = '', current, device, zones = allTimezones(), at = new Date() }: {
  search?: string; current?: string; device?: string; zones?: readonly string[]; at?: Date;
}): TimezoneOption[] {
  const needle = search.trim().toLowerCase().replaceAll(' ', '_');
  const pinned = [current, device].filter((zone): zone is string => Boolean(zone) && isTimezone(zone!));
  const pool = needle ? [...new Set([...pinned, ...zones, ...POPULAR_TIMEZONES])] : [...POPULAR_TIMEZONES];
  const options = pool.filter(isTimezone).map(zone => timezoneOption(zone, at));
  const byOffset = (a: TimezoneOption, b: TimezoneOption) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city);
  if (needle) {
    return options
      .filter(o => o.zone.toLowerCase().includes(needle) || o.offset.toLowerCase().replace('−', '-').includes(needle.replace('−', '-')))
      .sort(byOffset);
  }
  const head = [...new Set(pinned)].map(zone => timezoneOption(zone, at));
  return [...head, ...options.filter(o => !pinned.includes(o.zone)).sort(byOffset)];
}
