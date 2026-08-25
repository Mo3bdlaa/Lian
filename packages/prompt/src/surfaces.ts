// Surfaces.
//
// LESSONS §1: everything — chat, regeneration, scheduled tasks, proactive
// outreach, dreams, diary — calls the one assembler.  A surface selects which
// blocks are enabled and which directive is repeated last.  It never selects
// a different assembler, and there is no second code path to drift.
//
// prompt.test.ts enumerates this union and fails if any surface lacks a
// golden snapshot, so adding `dreams` later cannot quietly skip the path.
export const SURFACES = [
  'chat',        // the user is here, typing
  'regenerate',  // same turn, asked again — captures from the old one are voided
  'proactive',   // she reaches out first; lands on a lock screen
  'briefing',    // morning briefing, requested or proactive
  'scheduled',   // a reminder or task the user asked for
  'security',    // a sign-in needs confirming; calm, never bank-like
  'onboarding',  // the first conversation
  'incognito',   // reads memory, writes nothing
  'dream',       // background reflection, not user-facing
  'diary',       // background reflection, not user-facing
] as const;

export type Surface = (typeof SURFACES)[number];

export type SurfaceConfig = {
  /** Blocks this surface omits.  Omission is per-surface data, not a branch. */
  readonly omits: readonly string[];
  /** May this surface write to memory?  Incognito never does (Q12). */
  readonly writesMemory: boolean;
  /** Is the output delivered as a notification rather than into an open app? */
  readonly delivered: boolean;
  /** The key of the instruction repeated last.  LESSONS §1: models weight
   *  the end of the prompt, so the most important instruction goes there. */
  readonly directive: DirectiveKey;
};

export const DIRECTIVE_KEYS = [
  'reply_briefly', 'reply_again', 'reach_out', 'brief_the_day',
  'deliver_reminder', 'raise_security', 'get_acquainted', 'play_the_role',
  'reflect_privately',
] as const;
export type DirectiveKey = (typeof DIRECTIVE_KEYS)[number];

export const SURFACE_CONFIG: Readonly<Record<Surface, SurfaceConfig>> = {
  chat:       { omits: ['scenario'], writesMemory: true,  delivered: false, directive: 'reply_briefly' },
  regenerate: { omits: ['scenario'], writesMemory: true,  delivered: false, directive: 'reply_again' },
  proactive:  { omits: ['scenario'], writesMemory: true,  delivered: true,  directive: 'reach_out' },
  briefing:   { omits: ['scenario'], writesMemory: true,  delivered: true,  directive: 'brief_the_day' },
  scheduled:  { omits: ['scenario'], writesMemory: true,  delivered: true,  directive: 'deliver_reminder' },
  security:   { omits: ['scenario'], writesMemory: false, delivered: true,  directive: 'raise_security' },
  onboarding: { omits: ['scenario', 'memory'], writesMemory: true, delivered: false, directive: 'get_acquainted' },
  // Incognito is the only surface that renders the scenario block, and the
  // only one that writes nothing.  Both are properties of the surface, so
  // neither depends on a caller remembering.
  incognito:  { omits: [], writesMemory: false, delivered: false, directive: 'play_the_role' },
  dream:      { omits: ['scenario', 'capabilities'], writesMemory: true, delivered: false, directive: 'reflect_privately' },
  diary:      { omits: ['scenario', 'capabilities'], writesMemory: true, delivered: false, directive: 'reflect_privately' },
} as const;
