// Deciding what she might reach out about.
//
// Candidates come from three places and are merged here:
//   1. the capability registry (LESSONS §13) — a task due, a pattern noticed
//   2. memory follow-ups — something she was told that has a date attached
//   3. an unsurfaced reflection — "I was thinking about what you said"
//
// This is deliberately the ONLY place that composes them, because the thing
// that goes wrong with proactive messaging is not any single source, it is
// three sources each being reasonable and the user getting five messages.
import { backoffFor } from '@lian/domain';
import type { OutreachCandidate } from '@lian/domain';

export type CandidatePorts = {
  fromCapabilities(input: { userId: string; assistantId: string; localDay: string; timeZone: string; plan: 'free' | 'paid'; language: 'en' | 'ar' }): Promise<OutreachCandidate[]>;
  unsurfacedReflection(assistantId: string): Promise<{ id: string; body: string } | null>;
  unansweredStreak(assistantId: string): Promise<number>;
  daysSinceLastReachOut(assistantId: string, now: Date): Promise<number>;
  schedule(input: { assistantId: string; userId: string; candidate: OutreachCandidate }): Promise<boolean>;
};

export type CandidateReport = {
  proposed: number;
  scheduled: number;
  /** Dropped because she is already saying enough (LESSONS §4). */
  heldBack: number;
  /** Dropped because something equivalent is already scheduled. */
  duplicate: number;
};

/**
 * How many of HER OWN reach-outs may be pending at once.
 *
 * Not a rate limit — the plan's proactivePerDay is that.  This is a
 * composition limit: three good candidates on one day is how a product that
 * "reaches out thoughtfully" becomes a product that pesters.
 */
export const MAX_PENDING_ASSISTANT_INITIATED = 1;

export async function proposeOutreach(
  input: { userId: string; assistantId: string; localDay: string; timeZone: string; plan: 'free' | 'paid'; language: 'en' | 'ar'; now: Date },
  ports: CandidatePorts,
): Promise<CandidateReport> {
  const report: CandidateReport = { proposed: 0, scheduled: 0, heldBack: 0, duplicate: 0 };

  const candidates = [...(await ports.fromCapabilities(input))];

  const reflection = await ports.unsurfacedReflection(input.assistantId);
  if (reflection !== null) {
    candidates.push({
      kind: 'follow_up', source: 'assistant_initiated',
      scheduledFor: new Date(`${input.localDay}T17:00:00Z`),
      dedupeKey: `reflection:${reflection.id}`,
      reason: reflection.body.slice(0, 200),
    });
  }
  report.proposed = candidates.length;

  // LESSONS §4 decides whether she speaks at all.  Note what it is asked
  // about: her own unanswered messages, never the user's own reminders.
  const decision = backoffFor(
    await ports.unansweredStreak(input.assistantId),
    await ports.daysSinceLastReachOut(input.assistantId, input.now),
  );

  let assistantInitiated = 0;
  for (const candidate of candidates) {
    if (candidate.source === 'assistant_initiated') {
      if (!decision.send) { report.heldBack += 1; continue; }
      if (assistantInitiated >= MAX_PENDING_ASSISTANT_INITIATED) { report.heldBack += 1; continue; }
    }
    const scheduled = await ports.schedule({ assistantId: input.assistantId, userId: input.userId, candidate });
    if (scheduled) {
      report.scheduled += 1;
      if (candidate.source === 'assistant_initiated') assistantInitiated += 1;
    } else {
      // The dedupe key already exists: the same reminder, already pending.
      report.duplicate += 1;
    }
  }
  return report;
}
