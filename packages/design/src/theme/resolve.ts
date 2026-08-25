// ==========================================================================
// THIS FILE DECIDES THE THEME.  The values live in
// design-system/lian-tokens.css, which decides nothing.
//
// LESSONS §7: Noura's globals.css looked like the source of truth and was
// not — a runtime module overrode every token per mood, so changing the CSS
// alone left the old palette live.  That caught a capable agent with the
// files open in front of it.
//
// The repair here is stronger than "document both layers": the runtime writes
// ONE ATTRIBUTE and never a colour.  data-t="night-warm" on the root element
// repoints tier 2 at tier 1, in CSS, where the values already are.  There is
// no second layer to get out of step, and tools/gates/theme-single-writer.ts
// fails the build if any other file writes a colour or that attribute.
//
// Pre-hydration is a fallback only: an inline script sets the same attribute
// from a cookie before first paint, so SSR and client agree and there is no
// flash.  It computes nothing this file does not.
// ==========================================================================
import type { Mood } from '@lian/domain';

/** The five palettes defined in tier 1 of lian-tokens.css. */
export type ThemeName = 'day' | 'quiet' | 'night' | 'night-warm' | 'night-quiet';

/** Time controls environmental luminance (PRD §28). */
export type TimeBand = 'day' | 'night';

/**
 * Q8 decision: `auto` is the product, the other two are the accessibility
 * escape hatch.  They pin luminance only — mood still shapes accent, chroma
 * and decoration inside the pinned band — so forcing dark does not flatten
 * her into one appearance.
 */
export type ThemePreference = 'auto' | 'always-light' | 'always-dark';

/**
 * The night band, in local hours.  design.md §24 says "after midnight" and
 * PRD §28 calls the mode Late-night; 23:00 is where the evening stops being
 * day rather than where the date changes, and 06:00 is where it stops being
 * night.  One named constant, because these two numbers get argued about.
 */
export const NIGHT_BAND = { startsHour: 23, endsHour: 6 } as const;

export function timeBand(localHour: number): TimeBand {
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new RangeError(`localHour must be an integer 0–23, got ${localHour}`);
  }
  return localHour >= NIGHT_BAND.startsHour || localHour < NIGHT_BAND.endsHour ? 'night' : 'day';
}

/**
 * Three moods × two luminance bands → the five palettes.  This mapping is
 * design.md §16: warm at 2am stays night, with warmer accents; it does not
 * become day.
 */
export function themeFor(band: TimeBand, mood: Mood): ThemeName {
  if (band === 'day') return mood === 'quiet' ? 'quiet' : 'day';
  if (mood === 'warm') return 'night-warm';
  if (mood === 'quiet') return 'night-quiet';
  return 'night';
}

export type ThemeInput = {
  localHour: number;
  mood: Mood;
  preference: ThemePreference;
};

/** The one decision point.  Nothing else in the product picks a theme. */
export function resolveTheme(input: ThemeInput): ThemeName {
  const band: TimeBand =
    input.preference === 'always-light' ? 'day'
    : input.preference === 'always-dark' ? 'night'
    : timeBand(input.localHour);
  return themeFor(band, input.mood);
}

/** Whether a resolved theme is a dark one — for meta[name=theme-color] etc. */
export function isDark(theme: ThemeName): boolean {
  return theme.startsWith('night');
}
