// Backoff and quiet hours — LESSONS §4.
//
// "She reaches out on her own, and backs off when nobody answers."  The
// counter that drives this counts ONLY her own unanswered messages; that part
// is enforced in the outreach repository.  This file decides what to do with
// the number, and the rule is deliberately steep: a product that keeps
// talking to someone who has stopped answering is the thing PRD §19 lists
// first under risks.
export type BackoffDecision = { readonly send: boolean; readonly reason: string };

/** After this many unanswered reach-outs she stops until they speak first. */
export const SILENCE_AFTER = 5;

export function backoffFor(unansweredStreak: number, daysSinceLastReachOut: number): BackoffDecision {
  if (unansweredStreak >= SILENCE_AFTER) {
    return { send: false, reason: 'she has said enough for now — waiting to be spoken to' };
  }
  // 0–1 unanswered: normal.  2: every other day.  3–4: weekly.
  const minimumGap = unansweredStreak <= 1 ? 0 : unansweredStreak === 2 ? 2 : 7;
  if (daysSinceLastReachOut < minimumGap) {
    return { send: false, reason: `backing off: ${unansweredStreak} unanswered, needs ${minimumGap} days` };
  }
  return { send: true, reason: 'ok' };
}

export type QuietHours = {
  readonly enabled: boolean;
  readonly startHour: number;
  readonly endHour: number;
  /** ISO weekdays 1–7.  Empty means every day. */
  readonly days: readonly number[];
  readonly allowSecurity: boolean;
};

/** UI-UX §31.  Applied SERVER-SIDE at send time: a client-side check silences
 *  nothing, because the notification has already been sent by then. */
export function isQuiet(quiet: QuietHours, localHour: number, isoWeekday: number, kind: 'security' | 'ordinary'): boolean {
  if (!quiet.enabled) return false;
  if (quiet.days.length > 0 && !quiet.days.includes(isoWeekday)) return false;
  const inWindow = quiet.startHour <= quiet.endHour
    ? localHour >= quiet.startHour && localHour < quiet.endHour
    : localHour >= quiet.startHour || localHour < quiet.endHour;  // crosses midnight
  if (!inWindow) return false;
  return !(kind === 'security' && quiet.allowSecurity);
}
