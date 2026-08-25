// Mood.
//
// Q9 decision: mood is RULE-DERIVED from affect signals, never declared by the
// model.  A generated mood phrase would be a second surface speaking in her
// voice with no golden test over it — which is LESSONS §1 reappearing wearing
// a different hat.  The model never picks the phrase; it picks nothing here.
//
// Mood has exactly one job in this product and two consumers: it feeds the
// state block of the assembled prompt, and it feeds theme resolution.  Both
// read the same stored value.
export type Mood = 'warm' | 'quiet' | 'neutral';

export const MOODS: readonly Mood[] = ['warm', 'quiet', 'neutral'] as const;

export function isMood(value: string): value is Mood {
  return (MOODS as readonly string[]).includes(value);
}

/** Signals a mood is derived from.  Deliberately small and observable. */
export type MoodSignals = {
  /** Assistant-initiated messages answered, over the recent window. */
  answeredRatio: number;
  /** Exchanges in the last 24h, normalised 0–1 against a typical day. */
  recentActivity: number;
  /** Sentiment of the user's recent messages, −1 (heavy) … 1 (light). */
  userAffect: number;
};

/** Thresholds live in one named constant.  Tuned from data later, not by feel. */
export const MOOD_THRESHOLDS = {
  /** Below this, the user has been heavy or terse: she goes quiet with them. */
  quietAffect: -0.25,
  /** Below this much recent contact, she does not perform warmth. */
  quietActivity: 0.2,
  /** Above both of these, warm. */
  warmAffect: 0.15,
  warmActivity: 0.4,
} as const;

export function deriveMood(signals: MoodSignals): Mood {
  const { userAffect, recentActivity } = signals;
  if (userAffect <= MOOD_THRESHOLDS.quietAffect || recentActivity < MOOD_THRESHOLDS.quietActivity) return 'quiet';
  if (userAffect >= MOOD_THRESHOLDS.warmAffect && recentActivity >= MOOD_THRESHOLDS.warmActivity) return 'warm';
  return 'neutral';
}
