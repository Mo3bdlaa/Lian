// Tasks and habits.
//
// One of the two reference capabilities.  Everything it knows about the rest
// of the product is in the Capability interface — it cannot import the prompt
// package, and the boundary gate enforces that (LESSONS §13).
//
// PRD §14: no add buttons anywhere.  Capture happens through conversation, so
// this capability's only write path is a control tag in her reply.
import type { Capability, CapabilityContext, CaptureOutcome, OutreachCandidate, ExportSlice } from '@lian/domain';
import type { CapabilityPorts } from '../ports.ts';
import { line } from '../copy.ts';

type TodoPayload = { title?: unknown; due?: unknown; habit?: unknown; recurrence?: unknown };

export const tasksCapability: Capability<CapabilityPorts> = {
  id: 'tasks',

  tags: [
    {
      name: 'todo', payload: true,
      usage: '{"title":"return the book","due":"2026-05-19"} — something they said they will do. Add "habit":true and a "recurrence" for something they want to do regularly.',
    },
  ],

  promptFragment(context) {
    return context.language === 'ar'
      ? 'الاحتفاظ باللي قالوا إنهم هيعملوه، والتذكير بيه في وقته.'
      : 'Keep track of what they said they would do, and remind them at the right time.';
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
    const dueOn = typeof payload.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.due) ? payload.due : null;
    const kind = payload.habit === true ? 'habit' : 'task';
    if (kind === 'habit' && payload.recurrence === undefined) return { ok: false, reason: 'a habit needs a recurrence' };

    const task = await ports.tasks.create(context.userId, {
      kind, title, dueOn, recurrence: payload.recurrence ?? null,
      originMessageId: messageId, originAssistantId: context.assistantId,
    });

    return {
      ok: true, entityTable: 'tasks', entityId: task.id,
      summary: {
        capability: 'tasks', icon: 'i-tasks',
        line: dueOn === null ? title : `${title} · ${dueOn}`,
        correctionRoute: `/tasks/${task.id}`,
      },
    };
  },

  async proposeOutreach(context, ports): Promise<OutreachCandidate[]> {
    const due = await ports.tasks.dueOn(context.userId, context.localDay);
    const done = new Set(await ports.tasks.completionsOn(context.userId, context.localDay));
    return due
      .filter((task) => !done.has(task.id))
      .map((task) => ({
        kind: 'reminder' as const,
        // LESSONS §4: THEY asked for this reminder.  It is user_requested, so
        // an unanswered one never counts toward her backing off.  Noura
        // counted these and muted herself.
        source: 'user_requested' as const,
        scheduledFor: new Date(`${context.localDay}T09:00:00Z`),
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
