// Copy resolution.
export { CATALOG, type CopyKey, type Entry } from './catalog.ts';
export { addressViolations, normaliseArabic, SAFE_FORMS, type Addressee, type AddressViolation } from './arabic.ts';

import { CATALOG, type CopyKey } from './catalog.ts';

export type Language = 'en' | 'ar';
export type AssistantGender = 'female' | 'male';

/**
 * The one lookup.  Assistant gender selects between two AUTHORED Arabic
 * strings where they exist; it never transforms one into the other.
 */
export function t(key: CopyKey, language: Language, gender: AssistantGender = 'female'): string {
  const entry = CATALOG[key];
  if (language === 'en') return entry.en;
  if (gender === 'male' && 'arMale' in entry && typeof entry.arMale === 'string') return entry.arMale;
  return entry.ar;
}

/** Which script a language_style setting is written in (PRD §29). */
export function languageOf(languageStyle: string): Language | 'fr' {
  if (languageStyle.startsWith('ar')) return 'ar';
  if (languageStyle === 'fr') return 'fr';
  return 'en';
}
