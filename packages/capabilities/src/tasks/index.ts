// Tasks and habits.
//
// One of the two reference capabilities.  Everything it knows about the rest
// of the product is in the Capability interface — it cannot import the prompt
// package, and the boundary gate enforces that (LESSONS §13).
//
// PRD §14: no add buttons anywhere.  Capture happens through conversation, so
// this capability's only write path is a control tag in her reply.
import { atLocalHour } from '@lian/domain';
import type { Capability, CapabilityContext, CaptureOutcome, OutreachCandidate, ExportSlice } from '@lian/domain';
import type { CapabilityPorts } from '../ports.ts';
import { line } from '../copy.ts';

type TodoPayload = { title?: unknown; due?: unknown; freq?: unknown; days?: unknown };

/** Local hour a due task is raised at. Early enough to act on, late enough
 *  not to be the thing that wakes someone. */
const REMINDER_HOUR = 9;

/** One line, one place: the row is written at capture time and read back
 *  later by the screens, and the two must not drift. */
function taskLine(title: string, dueOn: string | null): string {
  return dueOn === null ? title : `${title} · ${dueOn}`;
}

type Recurrence = { freq?: unknown; days?: unknown };

/** ISO weekday, 1 = Monday. The day string is a calendar date, so reading it
 *  as UTC is exact rather than approximate. */
function isoWeekdayOf(localDay: string): number {
  return ((new Date(`${localDay}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function recursOn(recurrence: unknown, localDay: string): boolean {
  if (recurrence === null || typeof recurrence !== 'object') return false;
  const { freq, days } = recurrence as Recurrence;
  if (freq === 'daily') return true;
  if (freq !== 'weekly' || !Array.isArray(days)) return false;
  return days.includes(isoWeekdayOf(localDay));
}

export const tasksCapability: Capability<CapabilityPorts> = {
  id: 'tasks',

  // Two tags, one capability.  A habit IS a task with a recurrence — same
  // correction screen, same day-specific completion, same origin hint — so
  // splitting it into a second capability would mean two things writing one
  // table.  It gets its own TAG because the model needs the distinction
  // ("I want to drink more water" is not "remind me to call the bank"), and
  // because a single tag with a boolean flag gets the flag forgotten.
  tags: [
    {
      name: 'todo', payload: true,
      usage: '{"title":"return the book","due":"2026-05-19"} — one thing they said they will do, once.',
    },
    {
      name: 'habit', payload: true,
      usage: '{"title":"drink more water","freq":"daily"} or {"title":"swim","freq":"weekly","days":[2,5]} — something they want to do regularly. Days are 1=Monday.',
    },
  ],

  promptFragment(context) {
    return context.language === 'ar'
      ? 'الاحتفاظ باللي قالوا إنهم هيعملوه والتذكير بيه في وقته، والعادات اللي عايزين يكرروها.'
      : 'Keep track of what they said they would do and remind them at the right time, and of habits they want to repeat.';
  },

  async contextFragment(context, ports) {
    const due = await ports.tasks.dueOn(context.userId, context.localDay);
    if (due.length === 0) return null;
    const done = new Set(await ports.tasks.completionsOn(context.userId, context.localDay));
    const outstanding = due.filter((task) => !done.has(task.id));
    if (outstanding.length === 0) return line(context.language, 'Everything due today is done.', 'كل اللي مستحق النهاردة خلص.');
    return line(
      context.language,
      `Due today: ${outstanding.map((t) => t.title).join('; ')}.`,
      `مستحق النهاردة: ${outstanding.map((t) => t.title).join('؛ ')}.`,
    );
  },

  async handle({ context, tag, messageId }, ports): Promise<CaptureOutcome> {
    const payload = (tag.payload ?? {}) as TodoPayload;
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    // Q7: a capture that cannot be trusted is refused, not guessed at.  She
    // has already said "I'll remind you" by the time this runs, so the turn
    // needs a real answer either way.
    if (title === '') return { ok: false, reason: 'no title' };

    const isHabit = tag.name === 'habit';
    let recurrence: unknown = null;
    if (isHabit) {
      const freq = payload.freq;
      if (freq !== 'daily' && freq !== 'weekly') return { ok: false, reason: 'a habit needs to be daily or weekly' };
      const days = Array.isArray(payload.days)
        ? payload.days.filter((day): day is number => typeof day === 'number' && day >= 1 && day <= 7)
        : [];
      if (freq === 'weekly' && days.length === 0) return { ok: false, reason: 'a weekly habit needs days' };
      recurrence = { freq, days };
    }

    const dueOn = !isHabit && typeof payload.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.due) ? payload.due : null;

    const task = await ports.tasks.create(context.userId, {
      kind: isHabit ? 'habit' : 'task', title, dueOn, recurrence,
      originMessageId: messageId, originAssistantId: context.assistantId,
    });

    return {
      ok: true, entityTable: 'tasks', entityId: task.id,
      summary: {
        capability: 'tasks', icon: isHabit ? 'i-habit' : 'i-tasks',
        line: taskLine(title, isHabit ? null : dueOn),
        correctionRoute: `/tasks/${task.id}`,
      },
    };
  },

  async describe({ entityIds, context }, ports) {
    const rows = await ports.tasks.byIds(context.userId, entityIds);
    return Object.fromEntries(rows.map((task) => [task.id, {
      capability: 'tasks', icon: task.kind === 'habit' ? 'i-habit' : 'i-tasks',
      line: taskLine(task.title, task.kind === 'habit' ? null : task.dueOn),
      correctionRoute: `/tasks/${task.id}`,
    }]));
  },

  async proposeOutreach(context, ports): Promise<OutreachCandidate[]> {
    const due = await ports.tasks.dueOn(context.userId, context.localDay);
    const done = new Set(await ports.tasks.completionsOn(context.userId, context.localDay));
    return due
      .filter((task) => !done.has(task.id))
      // The repository returns every habit — it cannot read a recurrence and
      // should not try.  A weekly habit on Mondays and Wednesdays is not a
      // daily reminder, and being reminded of it on Friday is how someone
      // turns her notifications off.
      .filter((task) => task.kind !== 'habit' || recursOn(task.recurrence, context.localDay))
      .map((task) => ({
        kind: 'reminder' as const,
        // LESSONS §4: THEY asked for this reminder.  It is user_requested, so
        // an unanswered one never counts toward her backing off.  Noura
        // counted these and muted herself.
        source: 'user_requested' as const,
        // Nine in the morning WHERE THEY ARE. The Z-anchored version of
        // this line delivered a morning reminder at one in the afternoon in
        // Dubai, which is most of the intended market.
        scheduledFor: atLocalHour(context.localDay, REMINDER_HOUR, context.timeZone),
        dedupeKey: `task:${task.id}:${context.localDay}`,
        reason: task.title,
      }));
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'tasks', rows: await ports.tasks.all(userId) }];
  },

  async purgeFor(userId, ports): Promise<void> {
    await ports.tasks.purge(userId);
  },
};
