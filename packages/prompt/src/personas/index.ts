// Personas.
//
// PRD §45 / §49: v1 supports exactly two assistant genders, and "a male voice
// is not a mechanical pronoun swap".  So these are four AUTHORED texts, not
// one template with ${pronoun} in it — there is deliberately no interpolation
// here, because interpolation is how the second voice becomes the first voice
// wearing different pronouns.
//
// Q1: no archetypes.  The three prototype archetypes (progressive, secretary,
// companion) are dropped for v1; the five personality dials and the stage
// progression carry that variation instead.
//
// DECISIONS §21: she introduces herself as "a secretary, more or less".  She
// never claims closeness at signup — closeness is earned in the stages.
import { MissingPersonaError } from '../errors.ts';
import { PERSONA_FEMALE_EN } from './female.en.ts';
import { PERSONA_FEMALE_AR } from './female.ar.ts';
import { PERSONA_MALE_EN } from './male.en.ts';
import { PERSONA_MALE_AR } from './male.ar.ts';

export type PersonaGender = 'female' | 'male';
/** The scripts a persona is authored in.  Not the same as language_style:
 *  a dialect selects register within a script, and is applied by the
 *  environment block, not by swapping the persona. */
export type PersonaLanguage = 'en' | 'ar';

const PERSONAS: Record<PersonaGender, Partial<Record<PersonaLanguage, string>>> = {
  female: { en: PERSONA_FEMALE_EN, ar: PERSONA_FEMALE_AR },
  male: { en: PERSONA_MALE_EN, ar: PERSONA_MALE_AR },
};

/** Which script a language_style setting is written in. */
export function scriptFor(languageStyle: string): PersonaLanguage | 'fr' {
  if (languageStyle.startsWith('ar')) return 'ar';
  if (languageStyle === 'fr') return 'fr';
  return 'en';
}

export function personaFor(gender: PersonaGender, languageStyle: string): string {
  const script = scriptFor(languageStyle);
  // French is a first-class product language with no authored voice yet.
  // Falling back to English here would be the §1 failure: a different
  // personality depending on which path woke her.  It is an error until
  // someone writes it.
  if (script === 'fr') throw new MissingPersonaError(gender, 'fr');
  const text = PERSONAS[gender][script];
  if (text === undefined) throw new MissingPersonaError(gender, script);
  return text;
}

export function authoredPersonas(): { gender: PersonaGender; language: PersonaLanguage }[] {
  const out: { gender: PersonaGender; language: PersonaLanguage }[] = [];
  for (const gender of ['female', 'male'] as PersonaGender[]) {
    for (const language of ['en', 'ar'] as PersonaLanguage[]) {
      if (PERSONAS[gender][language] !== undefined) out.push({ gender, language });
    }
  }
  return out;
}
