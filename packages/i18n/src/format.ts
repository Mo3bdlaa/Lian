// ==========================================================================
// FORMATTING FOR A READER — the one place.
//
// Two different things use Intl in this product and only one of them is here.
//
//   A CALCULATOR.  `en-CA` to get YYYY-MM-DD in a time zone; `en-US` with
//                  hourCycle h23 to get an hour number. The locale is fixed
//                  BECAUSE the output is a machine key, and it must not
//                  change with who is reading. Those stay where they are —
//                  packages/domain/src/time.ts and the composition roots.
//
//   A SENTENCE.    A time, a date, an amount, a count, shown to a person, in
//                  the language they are reading. That is this file.
//
// It is one file because the second kind was in two — apps/web/src/format.ts
// and packages/capabilities/src/money — and they disagreed. The capture chip
// rendered `AED 400 · gym · 2026-08-24` three lines under a day separator
// that said "25 August", because the chip had no formatter and used the
// column. And the client's money() carried `minimumFractionDigits: 0`, so
// AED 127.50 rendered as "AED 127.5" in the Money headline.
//
// Neither was a bug in either call site. Both were a bug in there being two.
//
// `tools/gates/formatting.ts` is what keeps it one: reader-facing Intl
// outside this file fails the build, and the calculator uses are a named
// list that each say why their locale is fixed.
// ==========================================================================
/** Duplicated from index.ts rather than imported: index re-exports THIS
 *  file, and importing back from it is a cycle. Two words, one place each. */
export type Language = 'en' | 'ar';

/**
 * Arabic gets `ar-EG`, which renders Eastern Arabic numerals (٧:٣٢, ٤٠٠).
 *
 * That is not decoration: the reference screens use them throughout, and
 * Latin digits inside an Arabic sentence are wrong in exactly the way this
 * design set is careful not to be. English gets `en-GB` for day-before-month.
 */
const locale = (language: Language): string => (language === 'ar' ? 'ar-EG' : 'en-GB');

/** A clock time, in the reader's language and their own time zone. */
export function formatTime(iso: string, language: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(language), {
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).format(new Date(iso));
}

/** A calendar day as "25 August" / "٢٥ أغسطس". Never an ISO string: a column
 *  is not a date somebody reads, and that is what the chip was showing. */
export function formatDate(day: string, language: Language, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(locale(language), {
    day: 'numeric', month: 'long', timeZone,
  }).format(new Date(`${day}T12:00:00Z`));
}

export function formatCount(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language)).format(value);
}

/**
 * Minor units to a readable amount — money is integers everywhere else.
 *
 * NO fraction-digit overrides, deliberately. `minimumFractionDigits: 0`
 * rendered AED 127.50 as "AED 127.5" — in the headline, with a trailing
 * single decimal that reads as a typo rather than an amount. Intl knows each
 * currency's own precision (AED and USD two, JPY none, KWD three), so saying
 * nothing is shorter AND correct in more places than any pair of numbers
 * chosen here.
 *
 * The currency's name comes from Intl too, rather than a table of symbols: it
 * renders د.إ in Arabic and AED in English without either being written down,
 * and it is right for a currency this product has never seen.
 */
export function formatMoney(minor: number, currency: string, language: Language): string {
  return new Intl.NumberFormat(locale(language), {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol',
  }).format(minor / 100);
}

/**
 * Today, yesterday, or a date — as a KEY plus an optional formatted date.
 *
 * The two words are keys rather than strings because every word in this
 * product is authored in the catalogue, where the Arabic gate can see it.
 * This file formats numbers and dates; it does not speak.
 */
export function relativeDay(
  day: string, today: string, language: Language, timeZone = 'UTC',
): { key: 'today' | 'yesterday' } | { date: string } {
  if (day === today) return { key: 'today' };
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return { key: 'yesterday' };
  return { date: formatDate(day, language, timeZone) };
}
