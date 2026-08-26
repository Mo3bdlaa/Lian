// Formatting that has to match the language being read.
//
// Arabic uses Eastern Arabic numerals throughout the reference screens
// (٧:٣٢, ٤٠٠ د.إ), so a time or an amount rendered with Latin digits inside
// an Arabic sentence is wrong in the way the design set is careful not to be.
// Intl does this correctly for both, and doing it here means one place.
export type Language = 'en' | 'ar';

const locale = (language: Language): string => (language === 'ar' ? 'ar-EG' : 'en-GB');

export function time(iso: string, language: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(language), { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

/**
 * Which day a message belongs to, as a key.
 *
 * Returns 'today' / 'yesterday' / a formatted date. The two words are keys
 * rather than strings because every word in this product is authored in the
 * catalogue, where the Arabic gate can see it — this file formats numbers and
 * dates, it does not speak.
 */
export function dayOf(iso: string, timeZone: string, today: string): { key: 'today' | 'yesterday' } | { date: string } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  if (day === today) return { key: 'today' };
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000));
  if (day === yesterday) return { key: 'yesterday' };
  return { date: day };
}

export function dateLabel(day: string, language: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(language), { day: 'numeric', month: 'long', timeZone }).format(new Date(`${day}T12:00:00Z`));
}

export function count(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language)).format(value);
}

/**
 * Minor units to a readable amount — money is integers everywhere else.
 *
 * The currency name comes from Intl rather than from a table of symbols: it
 * renders د.إ in Arabic and AED in English without either being written down
 * here, and it is right for a currency this product has never seen.
 */
export function money(minor: number, currency: string, language: Language): string {
  return new Intl.NumberFormat(locale(language), {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(minor / 100);
}
