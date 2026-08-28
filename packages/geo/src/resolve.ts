// An address to a place, with the confidence it deserves.
//
// THE RULE THIS FILE EXISTS FOR: a security screen answers "was that you?",
// and a confident wrong city produces exactly the false alarm it exists to
// prevent. Mobile carriers route a whole country through one metro; a VPN
// puts somebody in Frankfurt; Private Relay names a city near them and often
// not theirs. Somebody who gets two false alarms stops reading the screen —
// which is worse than the screen never having had a location on it.
//
// So every answer here is hedged by construction:
//
//   a city is rendered as NEAR it, never as it;
//   low confidence degrades to the country, not to a worse city;
//   nothing at all degrades to NOTHING, never to "Unknown".
//
// "Unknown" is the one that looks harmless and is not: it is a row on a
// security screen that says something happened somewhere, which is what the
// reader already knew, taking up the space where a real answer would go.
import { Mmdb } from './mmdb.ts';
import { toBytes, isRoutable } from './address.ts';

/**
 * How far the database thinks it might be wrong, in kilometres, before the
 * city is dropped for the country.
 *
 * MaxMind's `accuracy_radius` is a radius the point is probably within. Fifty
 * kilometres is about the width of a metropolitan area: inside it, "near
 * Dubai" is a fair thing to say to somebody who is in Sharjah. Outside it the
 * city name is a guess wearing a place name, and the country is the largest
 * true thing available.
 *
 * ASSUMPTION, stated because it is a judgement rather than a measurement: no
 * traffic has been checked against this. It errs toward saying less.
 */
export const CITY_ACCURACY_KM = 50;

export type Place =
  /** A city, to be rendered as "Near {name}" and never as "{name}". */
  | { readonly kind: 'near'; readonly name: string }
  /** The country, when a city would be a guess. Rendered as "In {name}". */
  | { readonly kind: 'country'; readonly name: string };

export type GeoLookup = (ip: string, language: 'en' | 'ar') => Place | null;

/** The shape both GeoLite2-City and DB-IP City return. Everything is
 *  optional because the free databases genuinely omit fields, and a reader
 *  that assumes otherwise crashes on the row that matters. */
type CityRecord = {
  city?: { names?: Record<string, string> };
  country?: { names?: Record<string, string>; iso_code?: string };
  registered_country?: { names?: Record<string, string> };
  location?: { accuracy_radius?: number };
};

const nameIn = (names: Record<string, string> | undefined, language: 'en' | 'ar'): string | null => {
  if (names === undefined) return null;
  // The database carries its own translations, so an Arabic reader gets the
  // Arabic name from the same row rather than from a table we would maintain.
  //
  // AND OFTEN DOES NOT. DB-IP's free country database ships de, en, es, fa,
  // fr, ja, ko, pt-BR, ru and zh-CN — no Arabic. So an Arabic reader sees
  // "قريب من Dubai", a Latin place name inside an Arabic sentence, which is
  // the one thing packages/i18n is careful about everywhere else.
  //
  // It is still the right answer. The alternative is a table of place names
  // maintained here, which is a second source of truth for every city on
  // earth, wrong in a different way each month, and a guaranteed
  // disagreement with the database beside it. A place name in the wrong
  // script is legible; a place name we invented is not checkable.
  //
  // If it matters enough to fix, the fix is a database that has the names —
  // GeoLite2 carries more languages — and not code. ACCOUNTS.md says so.
  return names[language] ?? names['en'] ?? null;
};

/**
 * Open the database once and return a lookup, or null if it cannot be read.
 *
 * NULL RATHER THAN THROWING. A missing or corrupt geo file must not stop the
 * product from starting: the loss is one supporting line on one screen, and a
 * deployment that refuses to boot over it has turned a nicety into an outage.
 * The caller reports it as a degraded capability, the way a missing speech
 * key is reported.
 */
export function openGeo(path: string, onError: (message: string) => void): GeoLookup | null {
  let database: Mmdb;
  try {
    database = Mmdb.open(path);
  } catch (error) {
    onError(`geo database at ${path} could not be read: ${(error as Error).message}`);
    return null;
  }
  return (ip, language) => lookupIn(database, ip, language);
}

/** Exported for the tests, which build a database in memory rather than
 *  shipping a copy of somebody's file in this repository. */
export function lookupIn(database: Mmdb, ip: string, language: 'en' | 'ar'): Place | null {
  const bytes = toBytes(ip);
  // Not an address, or an address nobody routes: say nothing. A private range
  // reaching this point usually means the deployment is reading the wrong
  // header, and inventing a city for it would hide that.
  if (bytes === null || !isRoutable(bytes)) return null;

  let record: CityRecord | null;
  try {
    record = database.lookup(bytes) as CityRecord | null;
  } catch {
    // A corrupt row is one row. It must not take the screen down.
    return null;
  }
  if (record === null || typeof record !== 'object') return null;

  const country = nameIn(record.country?.names, language)
    ?? nameIn(record.registered_country?.names, language);
  const city = nameIn(record.city?.names, language);
  const radius = record.location?.accuracy_radius;

  // A city only when the database has one AND says it is reasonably sure. A
  // country-level database has no city at all and lands here every time,
  // which is the correct answer for it rather than a degradation.
  if (city !== null && (radius === undefined || radius <= CITY_ACCURACY_KM)) {
    return { kind: 'near', name: city };
  }
  if (country !== null) return { kind: 'country', name: country };
  return null;
}
