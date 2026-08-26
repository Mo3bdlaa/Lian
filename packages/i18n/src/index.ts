// Copy resolution.
export { CATALOG, type CopyKey, type Entry } from './catalog.ts';
export { addressViolations, normaliseArabic, isFirstPersonVerb, SAFE_FORMS, type Addressee, type AddressViolation } from './arabic.ts';

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

/**
 * The chat header's state phrase (UI-UX §3).
 *
 * Bounded and AUTHORED: one phrase per mood × time band, in both languages,
 * with masculine counterparts where Arabic needs them.  Nothing here is
 * generated — a generated phrase would be a second surface speaking in her
 * voice with no golden test over it (Q9).
 *
 * In incognito the mood label is suppressed and the role line shows instead
 * (PRD §27), so the caller passes 'incognito' and gets the label, not a mood.
 */
export function moodPhrase(
  mood: 'warm' | 'quiet' | 'neutral' | 'incognito',
  band: 'day' | 'night',
  language: Language,
  gender: AssistantGender = 'female',
): string {
  if (mood === 'incognito') return t('mood.incognito', language, gender);
  return t(`mood.${mood}.${band}` as CopyKey, language, gender);
}

/** Which script a language_style setting is written in (PRD §29). */
export function languageOf(languageStyle: string): Language | 'fr' {
  if (languageStyle.startsWith('ar')) return 'ar';
  if (languageStyle === 'fr') return 'fr';
  return 'en';
}
