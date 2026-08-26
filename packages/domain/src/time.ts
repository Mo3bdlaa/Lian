// Local time.  Every rule in the product that says "today" or "at 2am" means
// the user's local day, not the server's: the free-message counter resets at
// user-local midnight, quiet hours are local, and the theme's night band is
// local.  Doing this once, here, is what keeps those three consistent.
export type Hour = number; // 0–23

export function localHour(now: Date, timeZone: string): Hour {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  if (hour === undefined) throw new Error(`cannot read local hour for time zone: ${timeZone}`);
  return Number(hour);
}

/** The user's local calendar day as YYYY-MM-DD — the key usage counters use. */
export function localDayKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const [y, m, d] = [get('year'), get('month'), get('day')];
  if (y === undefined || m === undefined || d === undefined) throw new Error(`cannot read local day for time zone: ${timeZone}`);
  return `${y}-${m}-${d}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which it is `hour` o'clock on `localDay` in `timeZone`.
 *
 * The inverse of the two functions above, and the one the schedule needs:
 * "her morning reminder at nine" means nine where the person is. Writing it
 * as `new Date(`${day}T09:00:00Z`)` is nine in Reykjavík and one in the
 * afternoon in Dubai — which is how a reminder system quietly becomes an
 * afternoon reminder system for everyone east of London.
 *
 * Two passes because the offset depends on the instant, and the instant
 * depends on the offset: the first pass lands within an hour, the second
 * lands on it. Across a DST transition the second pass may still be off by
 * the jump — an hour, once or twice a year, in a system whose quiet-hours
 * check runs afterwards anyway.
 */
export function atLocalHour(localDay: string, hour: Hour, timeZone: string): Date {
  const wallClock = Date.parse(`${localDay}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (Number.isNaN(wallClock)) throw new Error(`not a local day: ${localDay}`);
  let instant = wallClock;
  for (let pass = 0; pass < 2; pass += 1) instant = wallClock - zoneOffsetMillis(new Date(instant), timeZone);
  return new Date(instant);
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function zoneOffsetMillis(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asIfUtc - instant.getTime();
}
