// The schedule.
//
// One entry point, called by an external ticker (Q16), that runs everything
// time-driven: her due messages, tomorrow's candidates, the reminders and
// recurring habits behind them, the morning briefing, dreams, diary, and the
// sweeps that keep the two operational tables from growing forever.
//
// The design decision worth stating: every per-user job is gated on the
// USER'S local hour, not the server's. A schedule written in UTC is a
// schedule that works in London and reads as three in the afternoon in
// Dubai — and this product's first market is Dubai.
//
// So the tick is idempotent and frequent. It runs every few minutes, decides
// per time zone whether that zone has just reached the hour a job belongs
// to, and does nothing at all the rest of the time. Nothing here assumes it
// runs exactly once an hour: dedupe keys and `alreadyReflected` make a double
// run cheap, and a missed run is caught by the next one inside the window.
import * as db from '@lian/db';
import { localDayKey, localHour } from '@lian/domain';
import {
  runTick, runReflections, proposeOutreach, tickPorts, candidatePorts, reflectPorts,
  type JobDeps, type TickReport, type ReflectReport, type ReflectPorts,
} from '@lian/jobs';

/**
 * The local hours each job runs at.
 *
 * ASSUMPTIONS, and they are product choices rather than measurements:
 *   propose   5am — before the earliest thing it can schedule (the 7am
 *                   briefing), so a candidate proposed today can be sent today
 *   dream     2am — the night, and after the day it is about has ended
 *   diary    23pm — the day is over but not yet yesterday
 * Nothing measured these. They are stated here so changing one is a decision
 * rather than an edit.
 */
export const SCHEDULE_HOURS = { propose: 5, dream: 2, diary: 23 } as const;

/** How wide a window each hourly job accepts. One hour: with a ticker running
 *  every few minutes, this fires several times inside the hour, and every job
 *  below is idempotent by dedupe key or by a unique index. */
const WINDOW_HOURS = 1;

/** Rows considered per run. A batch, not a promise to finish. */
const BATCH = 200;

export type ScheduleReport = {
  readonly at: string;
  readonly outreach: TickReport;
  readonly proposed: { assistants: number; scheduled: number; heldBack: number; duplicate: number };
  readonly dreams: ReflectReport | null;
  readonly diary: ReflectReport | null;
  readonly swept: { abandonedUploads: number; rateLimits: number; staleIdempotency: number; oldIdempotency: number };
};

const EMPTY_PROPOSED = { assistants: 0, scheduled: 0, heldBack: 0, duplicate: 0 };

/** Windows and finished keys older than these are dead weight. */
const RATE_LIMIT_RETENTION_HOURS = 24;
const IDEMPOTENCY_IN_FLIGHT_MINUTES = 15;
const IDEMPOTENCY_RETENTION_DAYS = 7;
/** Longer than the signed upload URL lives, so a slow upload is not swept
 *  out from under itself. */
const ABANDONED_UPLOAD_MINUTES = 60;

export function scheduleRunner(deps: JobDeps & { store: { remove(keys: readonly string[]): Promise<number> } | null }): (now: Date) => Promise<ScheduleReport> {
  return async (now: Date): Promise<ScheduleReport> => {
    // 1. Deliver what is already due. This is the only step that runs on
    //    every tick regardless of anyone's local hour — a reminder set for
    //    2:15pm is due at 2:15pm.
    const outreach = await runTick(now, tickPorts(deps));

    // 2. Everything else is per time zone.
    const active = await activeAssistants(now);
    const zones = new Map<string, typeof active>();
    for (const row of active) {
      const list = zones.get(row.timeZone) ?? [];
      list.push(row);
      zones.set(row.timeZone, list);
    }

    let proposed = { ...EMPTY_PROPOSED };
    let dreams: ReflectReport | null = null;
    let diary: ReflectReport | null = null;

    for (const [timeZone, rows] of zones) {
      const hour = localHour(now, timeZone);
      const localDay = localDayKey(now, timeZone);

      if (within(hour, SCHEDULE_HOURS.propose)) {
        for (const row of rows) {
          const user = await db.accounts.getUser({ userId: row.userId });
          if (user === null) continue;
          const report = await proposeOutreach(
            {
              userId: row.userId, assistantId: row.assistantId, localDay, timeZone,
              plan: user.plan, language: user.languageStyle.startsWith('ar') ? 'ar' : 'en', now,
            },
            candidatePorts(),
          );
          proposed = {
            assistants: proposed.assistants + 1,
            scheduled: proposed.scheduled + report.scheduled,
            heldBack: proposed.heldBack + report.heldBack,
            duplicate: proposed.duplicate + report.duplicate,
          };
        }
      }

      // A dream at 2am is about the day that just ended, so it is filed
      // under yesterday — which is also the day whose messages it reads.
      if (within(hour, SCHEDULE_HOURS.dream)) {
        dreams = merge(dreams, await runReflections(
          { kind: 'dream', localDay: dayBefore(localDay) },
          restrictedTo(reflectPorts(deps), rows.map((row) => row.assistantId)),
        ));
      }
      if (within(hour, SCHEDULE_HOURS.diary)) {
        diary = merge(diary, await runReflections(
          { kind: 'diary', localDay },
          restrictedTo(reflectPorts(deps), rows.map((row) => row.assistantId)),
        ));
      }
    }

    // 3. Sweeps. Cheap deletes, every tick, so neither table needs a person
    //    to remember it exists.
    // Uploads that were signed and never completed: a row with no bytes, or
    // bytes with no row pointing at them. Both are swept by age.
    const abandoned = await db.attachments.abandoned(minutesAgo(now, ABANDONED_UPLOAD_MINUTES), BATCH);
    for (const upload of abandoned) {
      if (deps.store !== null && upload.storageKey !== '') await deps.store.remove([upload.storageKey]);
      await db.attachments.deleteRows({ userId: upload.userId }, [upload.id]);
    }

    const swept = {
      abandonedUploads: abandoned.length,
      rateLimits: await db.limits.sweepRateLimits(hoursAgo(now, RATE_LIMIT_RETENTION_HOURS)),
      // A request that died mid-flight leaves a claimed key. Released by age
      // so a crash does not lock a client out of retrying forever.
      staleIdempotency: await db.limits.releaseStaleIdempotency(minutesAgo(now, IDEMPOTENCY_IN_FLIGHT_MINUTES)),
      oldIdempotency: await db.limits.sweepIdempotency(hoursAgo(now, IDEMPOTENCY_RETENTION_DAYS * 24)),
    };

    return { at: now.toISOString(), outreach, proposed, dreams, diary, swept };
  };
}

/**
 * Assistants whose user has been active recently.
 *
 * Both UTC days, because "today" is a different date in Kiritimati and
 * Honolulu at the same instant, and a job gated on the user's local hour has
 * to be able to find that user on whichever UTC day they are living in.
 */
async function activeAssistants(now: Date): Promise<{ assistantId: string; userId: string; timeZone: string; conversationId: string }[]> {
  const today = now.toISOString().slice(0, 10);
  const yesterday = dayBefore(today);
  const rows = [
    ...(await allActiveOn(yesterday)),
    ...(await allActiveOn(today)),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.assistantId) ? false : (seen.add(row.assistantId), true)));
}

/**
 * Every active assistant on one day, paged.
 *
 * The repository query is a keyset page, not a sample: a LIMIT with no cursor
 * would hand back the same first BATCH rows on every tick, so the two-hundred
 * and first account would never get a diary and nothing would say so. Paging
 * to exhaustion is bounded — the page is a database round trip per BATCH
 * accounts active on a day, and the tick already does one per account.
 */
async function allActiveOn(localDay: string): Promise<{ assistantId: string; userId: string; timeZone: string; conversationId: string }[]> {
  const all: { assistantId: string; userId: string; timeZone: string; conversationId: string }[] = [];
  let after: string | null = null;
  for (;;) {
    const page: { assistantId: string; userId: string; timeZone: string; conversationId: string }[] =
      await db.outreach.assistantsActiveOn(localDay, BATCH, after);
    all.push(...page);
    if (page.length < BATCH) return all;
    after = page[page.length - 1]!.assistantId;
  }
}

/** The reflection jobs batch by one local day; this keeps a run to the
 *  assistants whose time zone actually reached that hour. */
function restrictedTo(ports: ReflectPorts, assistantIds: readonly string[]): ReflectPorts {
  const allowed = new Set(assistantIds);
  return {
    ...ports,
    async dueForReflection(kind, localDay, limit, after) {
      const page = await ports.dueForReflection(kind, localDay, limit, after);
      // Rows filtered, cursor untouched: this restriction must not move the
      // page forward past the assistants it just dropped.
      return { rows: page.rows.filter((row) => allowed.has(row.assistantId)), next: page.next };
    },
  };
}

const within = (hour: number, target: number): boolean => hour >= target && hour < target + WINDOW_HOURS;
const hoursAgo = (now: Date, hours: number): Date => new Date(now.getTime() - hours * 60 * 60 * 1000);
const minutesAgo = (now: Date, minutes: number): Date => new Date(now.getTime() - minutes * 60 * 1000);

function dayBefore(localDay: string): string {
  return new Date(new Date(`${localDay}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function merge(existing: ReflectReport | null, next: ReflectReport): ReflectReport {
  if (existing === null) return next;
  return {
    considered: existing.considered + next.considered,
    written: existing.written + next.written,
    skipped: existing.skipped + next.skipped,
  };
}
