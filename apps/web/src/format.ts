// Formatting, delegated.
//
// It ALL lives in @lian/i18n now — see packages/i18n/src/format.ts for why.
// The short version: this file and packages/capabilities/src/money both did
// it, and they disagreed. A capture chip rendered `2026-08-24` three lines
// under a separator saying "25 August", and money() dropped the second
// decimal off AED 127.50. Neither was a bug in either call site; both were a
// bug in there being two.
//
// What remains here are the two things that are genuinely the CLIENT's: the
// day-key comparison, which needs the browser's own time zone, and the names
// the screens import.
import { formatTime, formatDate, formatCount, formatMoney } from '@lian/i18n';

export type Language = 'en' | 'ar';

export const time = formatTime;
export const dateLabel = formatDate;
export const count = formatCount;
export const money = formatMoney;

/**
 * Which day a message belongs to, as a key.
 *
 * Stays here because it compares against the BROWSER's idea of today, in the
 * viewer's time zone, and the comparison is a machine key rather than
 * something anybody reads — `en-CA` is a calculator here, not a locale.
 */
export function dayOf(iso: string, timeZone: string, today: string): { key: 'today' | 'yesterday' } | { date: string } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  if (day === today) return { key: 'today' };
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000));
  if (day === yesterday) return { key: 'yesterday' };
  return { date: day };
}
