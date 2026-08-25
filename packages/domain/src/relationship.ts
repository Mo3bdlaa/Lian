// Relationship progression — LESSONS §6.
//
// Closeness increases slowly, is earned through interaction, and does not go
// backwards.  It cannot be purchased, granted or skipped, and it is never
// surfaced as a score, level, bar or percentage.
//
// Q3 decision: progression counts QUALIFYING DAYS, not messages.  A day
// counts when the user has had a real exchange with her — several messages,
// in a conversation that persists.  Counting messages would let one talkative
// afternoon skip a stage, and would make the whole thing farmable by a script;
// counting days makes "hundreds of warm exchanges" mean elapsed relationship
// rather than volume.
//
// Incognito is excluded: it writes nothing (Q12), so it earns nothing.
export type Stage = 1 | 2 | 3 | 4 | 5;

/**
 * Qualifying days needed to enter each stage.
 *
 * TUNED FROM RETENTION DATA LATER, NOT FROM FEEL.  These are a starting
 * point, chosen so the last stage is roughly a year of most-days use and the
 * first two arrive early enough to be felt.  When there is D7/D30 data, the
 * thresholds move here and nowhere else.
 */
export const STAGE_THRESHOLDS: Readonly<Record<Stage, number>> = {
  1: 0,
  2: 3,
  3: 14,
  4: 45,
  5: 120,
} as const;

/** The fifth stage is the end of the ladder; 250 days is "long familiarity"
 *  in the copy, and is a floor on how long the last stage takes to feel
 *  earned.  Kept as a separate constant because it is the one the product
 *  promise ("hundreds of exchanges") is measured against. */
export const LONG_FAMILIARITY_DAYS = 250;

/** A day counts once the user has really been in it, not once they appeared. */
export const SUBSTANTIVE_MESSAGES_PER_QUALIFYING_DAY = 3;

export function stageFor(qualifyingDays: number): Stage {
  if (qualifyingDays >= STAGE_THRESHOLDS[5]) return 5;
  if (qualifyingDays >= STAGE_THRESHOLDS[4]) return 4;
  if (qualifyingDays >= STAGE_THRESHOLDS[3]) return 3;
  if (qualifyingDays >= STAGE_THRESHOLDS[2]) return 2;
  return 1;
}

/**
 * Never goes backwards, even if the counter were somehow lower — absence does
 * not demote her (LESSONS §6).  The database enforces the same rule with a
 * trigger; this is the same invariant stated where the decision is made.
 */
export function nextStage(currentStage: Stage, qualifyingDays: number): Stage {
  const earned = stageFor(qualifyingDays);
  return (earned > currentStage ? earned : currentStage) as Stage;
}

/**
 * The stage counter must never cross the network.  The API returns prose for
 * the current stage; this type is what a client is allowed to see.  There is
 * deliberately no `days`, `progress` or `next` field: LESSONS §6 says never a
 * score, level, bar or percentage, and a field is how one gets built.
 */
export type PublicRelationship = { stageKey: StageKey };

export const STAGE_KEYS = [
  'getting_acquainted',
  'finding_a_rhythm',
  'shape_of_your_week',
  'noticing_without_asking',
  'long_familiarity',
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export function stageKey(stage: Stage): StageKey {
  return STAGE_KEYS[stage - 1]!;
}

export function publicView(stage: Stage): PublicRelationship {
  return { stageKey: stageKey(stage) };
}
