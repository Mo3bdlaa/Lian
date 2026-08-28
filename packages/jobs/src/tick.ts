// The tick.
//
// Q16 / LESSONS §12: "Vercel Hobby runs cron roughly twice a day. Timely
// reminders need a paid plan or an external scheduler hitting a protected
// endpoint."  So this is a plain function behind an HMAC-signed endpoint,
// driven by whatever scheduler the deployment has — a container's cron, a
// GitHub Action, a worker.  Nothing here is Vercel-shaped.
//
// THREE THINGS MAKE IT SURVIVE A SCHEDULER THAT MISBEHAVES, and none of them
// were here until a resilience pass went looking:
//
//   TWICE AT ONCE. The old comment said "outreach rows carry a dedupe key,
//   and one that has been sent is not selected again", which was true
//   sequentially and false concurrently — `sent_at` is written AFTER
//   delivery, so two overlapping runs both saw NULL and both pushed. Every
//   piece of work is now CLAIMED first, and a claim is a conditional update
//   that exactly one writer wins (migration 0021).
//
//   NOT FOR SIX HOURS, THEN ALL AT ONCE. Work that is merely late is
//   delivered late. Work that is STALE is not: "shall we start the day" at
//   two in the afternoon is not a late message, it is a wrong one, and it is
//   the kind of thing that makes somebody turn notifications off. Only HER
//   messages go stale — a reminder the user set is theirs, and late is
//   strictly better than never (LESSONS §4, same distinction as backoff).
//
//   ONE FAILURE, NOT A HUNDRED. Delivery reaches a model and a push service,
//   both of which fail. An uncaught throw used to abandon the rest of the
//   batch — so the ninety-nine people behind the first failure heard nothing,
//   and the next tick started on the same broken row and did it again.
import { backoffFor, isQuiet, localHour, type QuietHours } from '@lian/domain';

export type DueOutreach = {
  readonly id: string;
  readonly userId: string;
  readonly assistantId: string;
  readonly conversationId: string;
  readonly kind: 'follow_up' | 'reminder' | 'habit' | 'unfinished' | 'briefing' | 'pattern' | 'security';
  readonly source: 'assistant_initiated' | 'user_requested';
  readonly timeZone: string;
  /** When it was meant to go, so "late" can be told from "stale". */
  readonly scheduledFor: Date;
};

export type TickPorts = {
  dueOutreach(now: Date, limit: number): Promise<DueOutreach[]>;
  quietHours(userId: string): Promise<QuietHours>;
  /** LESSONS §4: HER unanswered messages only.  The repository is the single
   *  reader of that count; the tick just asks. */
  unansweredStreak(assistantId: string): Promise<number>;
  daysSinceLastReachOut(assistantId: string, now: Date): Promise<number>;
  /**
   * Take this one, or discover somebody else already did.
   *
   * Called BEFORE delivery and after every decision that might drop the row,
   * so a run that loses the race spends nothing on it.
   */
  claim(outreachId: string): Promise<boolean>;
  /** Runs the SAME turn function as chat, with surface 'proactive'. */
  deliver(outreach: DueOutreach): Promise<'sent' | 'skipped'>;
  reschedule(outreachId: string, to: Date): Promise<void>;
  cancel(outreachId: string, reason: string): Promise<void>;
};

export type TickReport = {
  considered: number;
  sent: number;
  deferred: { id: string; reason: string }[];
  silenced: { id: string; reason: string }[];
  /** Rows another run had already taken. Reported rather than hidden: a
   *  number that is always zero says the schedulers are not overlapping, and
   *  a number that is never zero says one of them is redundant. */
  claimedElsewhere: string[];
  /** Delivery threw. Named with the row, so a log answers "who did not hear
   *  from her" rather than "something went wrong". */
  failed: { id: string; reason: string }[];
};

export const TICK_BATCH = 100;

/**
 * How late one of HER messages may be and still be worth sending.
 *
 * ASSUMPTION, stated because it is a product judgement and not a measurement:
 * four hours. Her outreach is written for a time of day — a morning briefing,
 * an evening follow-up — and four hours is roughly the width of one of those.
 * Past it the message has stopped being about now, and arriving anyway is how
 * a scheduler outage turns into somebody switching notifications off.
 *
 * A reminder the USER set is exempt. They asked for it; four hours late is a
 * worse outcome than on time and a much better one than never.
 */
export const STALE_AFTER_HOURS = 4;

export async function runTick(now: Date, ports: TickPorts): Promise<TickReport> {
  const due = await ports.dueOutreach(now, TICK_BATCH);
  const report: TickReport = {
    considered: due.length, sent: 0, deferred: [], silenced: [], claimedElsewhere: [], failed: [],
  };

  for (const outreach of due) {
    // ONE ROW CANNOT TAKE THE BATCH DOWN. Everything below reaches something
    // that fails — the database, a model, a push service — and the ninety-nine
    // people after this one are not party to that.
    try {
      const hour = localHour(now, outreach.timeZone);
      const isoWeekday = ((now.getUTCDay() + 6) % 7) + 1;

      // Quiet hours, decided here rather than on the device: by the time a
      // client could check, the notification has already arrived.
      const quiet = await ports.quietHours(outreach.userId);
      if (isQuiet(quiet, hour, isoWeekday, outreach.kind === 'security' ? 'security' : 'ordinary')) {
        // Deferred to the end of the quiet window, not dropped — a reminder the
        // user asked for still has to arrive.
        const resumeAt = new Date(now);
        resumeAt.setUTCHours(resumeAt.getUTCHours() + ((quiet.endHour - hour + 24) % 24 || 1));
        await ports.reschedule(outreach.id, resumeAt);
        report.deferred.push({ id: outreach.id, reason: 'quiet hours' });
        continue;
      }

      // Backoff applies ONLY to what she started.  A reminder the user set is
      // theirs, and silence about it is not a signal to stop delivering it —
      // that conflation is what muted Noura.
      if (outreach.source === 'assistant_initiated') {
        const decision = backoffFor(
          await ports.unansweredStreak(outreach.assistantId),
          await ports.daysSinceLastReachOut(outreach.assistantId, now),
        );
        if (!decision.send) {
          await ports.cancel(outreach.id, decision.reason);
          report.silenced.push({ id: outreach.id, reason: decision.reason });
          continue;
        }
      }

      // Stale, and hers: the moment it was written for has gone.
      const hoursLate = (now.getTime() - outreach.scheduledFor.getTime()) / 3_600_000;
      if (outreach.source === 'assistant_initiated' && hoursLate > STALE_AFTER_HOURS) {
        await ports.cancel(outreach.id, `stale by ${Math.floor(hoursLate)}h`);
        report.silenced.push({ id: outreach.id, reason: 'stale' });
        continue;
      }

      // LAST, and immediately before the spend. Claiming earlier would mean a
      // row deferred for quiet hours came back holding a lease it no longer
      // needs; claiming later would mean two runs both paid for the turn.
      if (!(await ports.claim(outreach.id))) {
        report.claimedElsewhere.push(outreach.id);
        continue;
      }

      const result = await ports.deliver(outreach);
      if (result === 'sent') report.sent += 1;
      else report.deferred.push({ id: outreach.id, reason: 'daily reach-out already spent' });
    } catch (error) {
      // The claim is deliberately NOT released here. It expires on its own
      // (CLAIM_LEASE_SECONDS), which is the difference between "retry in five
      // minutes" and "retry in a tight loop against whatever just broke".
      report.failed.push({ id: outreach.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return report;
}
