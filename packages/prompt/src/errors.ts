// LESSONS §1: "If required context is missing, that is an error, not a
// default."  Noura's scheduled jobs and proactive messages went through a
// different route that fell back to defaults, so she answered with a
// different personality depending on which code path woke her — invisible in
// chat, and only visible in the messages nobody was watching.
export class MissingContextError extends Error {
  readonly what: string;
  readonly surface: string;
  constructor(what: string, surface: string) {
    super(`cannot assemble the prompt for surface '${surface}': ${what} is missing. This is an error, not a default (LESSONS §1).`);
    this.name = 'MissingContextError';
    this.what = what;
    this.surface = surface;
  }
}

/** A persona voice that has not been authored yet.  §45: a male voice is not
 *  a mechanical pronoun swap, and an unauthored language is not English with
 *  a different label.  Falling back would be exactly the §1 failure. */
export class MissingPersonaError extends Error {
  readonly gender: string;
  readonly language: string;
  constructor(gender: string, language: string) {
    super(`no authored persona for ${gender}/${language}. A voice is authored, never derived — do not fall back (LESSONS §1, PRD §45).`);
    this.name = 'MissingPersonaError';
    this.gender = gender;
    this.language = language;
  }
}
