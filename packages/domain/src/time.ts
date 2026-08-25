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
