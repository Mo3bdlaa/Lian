// The tick.
//
// Q16 / LESSONS §12: "Vercel Hobby runs cron roughly twice a day. Timely
// reminders need a paid plan or an external scheduler hitting a protected
// endpoint."  So this is a plain function behind an HMAC-signed endpoint,
// driven by whatever scheduler the deployment has — a container's cron, a
// GitHub Action, a worker.  Nothing here is Vercel-shaped.
//
// It is idempotent: outreach rows carry a dedupe key, and one that has been
// sent is not selected again.  A scheduler that fires twice costs nothing.
import { backoffFor, isQuiet, localHour, type QuietHours } from '@lian/domain';

export type DueOutreach = {
  readonly id: string;
  readonly userId: string;
  readonly assistantId: string;
  readonly conversationId: string;
  readonly kind: 'follow_up' | 'reminder' | 'habit' | 'unfinished' | 'briefing' | 'pattern' | 'security';
  readonly source: 'assistant_initiated' | 'user_requested';
  readonly timeZone: string;
};

export type TickPorts = {
  dueOutreach(now: Date, limit: number): Promise<DueOutreach[]>;
  quietHours(userId: string): Promise<QuietHours>;
  /** LESSONS §4: HER unanswered messages only.  The repository is the single
   *  reader of that count; the tick just asks. */
  unansweredStreak(assistantId: string): Promise<number>;
  daysSinceLastReachOut(assistantId: string, now: Date): Promise<number>;
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
};

export const TICK_BATCH = 100;

export async function runTick(now: Date, ports: TickPorts): Promise<TickReport> {
  const due = await ports.dueOutreach(now, TICK_BATCH);
  const report: TickReport = { considered: due.length, sent: 0, deferred: [], silenced: [] };

  for (const outreach of due) {
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

    const result = await ports.deliver(outreach);
    if (result === 'sent') report.sent += 1;
    else report.deferred.push({ id: outreach.id, reason: 'daily reach-out already spent' });
  }

  return report;
}
